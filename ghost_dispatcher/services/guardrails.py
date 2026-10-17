"""PII guardrails: deterministic detection and redaction, no LLM calls.

Applied at every boundary where text enters or leaves the system: API inputs
(contracts), Gemini requests and responses (ADK callbacks), tool results, MCP
outputs, the SSE event stream and JSON API responses. Redacted values never
reach storage, the model or the UI; only the kind and count are recorded.
"""

import os
import re
from collections import Counter
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

TOKEN = "[REDACTED:{kind}]"


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


# Issuer prefixes: Visa, Mastercard, Amex, Diners, JCB, Discover/RuPay, RuPay.
_CARD_PREFIX = re.compile(r"^(?:4|5[1-5]|2[2-7]|3[47]|3[0689]|35|6|8[12]|508)")


def _is_card(value: str) -> bool:
    digits = _digits(value)
    grouped = re.fullmatch(r"\d{4}(?:[ -]\d{4}){3}", value.strip()) is not None
    return 13 <= len(digits) <= 19 and bool(_CARD_PREFIX.match(digits)) and (_luhn(digits) or grouped)


# Order matters: longer/more specific patterns first so a card number is not
# reported as a phone number. Lookarounds keep IDs, hex strings, timestamps,
# coordinates and costs from matching.
_PATTERNS: list[tuple[str, re.Pattern, Any]] = [
    (
        "EMAIL",
        re.compile(r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])"),
        None,
    ),
    (
        "CARD",
        re.compile(r"(?<![\w-])(?:\d[ -]?){12,18}\d(?![\w-])"),
        _is_card,
    ),
    (
        "AADHAAR",
        re.compile(r"(?<![\w-])(?<!\d[ -])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\w-])(?![ -]\d)"),
        None,
    ),
    (
        "PHONE",
        re.compile(r"(?<![\w+])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\w-])"),
        None,
    ),
    (
        "PHONE",
        re.compile(r"(?<![\w])\+\d{1,3}(?:[ -]?\(?\d{1,4}\)?){2,5}(?![\w-])"),
        lambda m: 8 <= len(_digits(m)) <= 15,
    ),
    ("PAN", re.compile(r"(?<![\w])[A-Z]{5}\d{4}[A-Z](?![\w])"), None),
    ("UPI", re.compile(r"(?<![\w.@-])[A-Za-z0-9._-]{2,}@(?:ok)?[a-z]{2,12}(?![\w.@-])"), None),
]


@dataclass(frozen=True)
class Finding:
    kind: str
    start: int
    end: int


def find_pii(text: str) -> list[Finding]:
    """All non-overlapping PII spans, most specific kind first."""
    if not text or not isinstance(text, str):
        return []
    found: list[Finding] = []
    taken: list[tuple[int, int]] = []
    for kind, pattern, check in _PATTERNS:
        for match in pattern.finditer(text):
            span = match.span()
            if any(span[0] < end and start < span[1] for start, end in taken):
                continue
            if "[REDACTED:" in text[max(0, span[0] - 10) : span[0]]:
                continue
            if check and not check(match.group(0)):
                continue
            taken.append(span)
            found.append(Finding(kind, *span))
    return sorted(found, key=lambda f: f.start)


def redact_text(text: str) -> tuple[str, Counter]:
    findings = find_pii(text)
    if not findings:
        return text, Counter()
    out, cursor = [], 0
    for f in findings:
        out.append(text[cursor : f.start])
        out.append(TOKEN.format(kind=f.kind))
        cursor = f.end
    out.append(text[cursor:])
    return "".join(out), Counter(f.kind for f in findings)


def redact(value: Any, counts: Counter | None = None) -> Any:
    """Deep-redact strings inside dicts/lists/tuples; other values pass through."""
    if isinstance(value, str):
        clean, found = redact_text(value)
        if counts is not None:
            counts.update(found)
        return clean
    if isinstance(value, dict):
        return {k: redact(v, counts) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(redact(v, counts) for v in value)
    return value


def contains_pii(value: Any) -> bool:
    counts: Counter = Counter()
    redact(value, counts)
    return bool(counts)


# ---- per-request bookkeeping -------------------------------------------------

_collected: ContextVar[Counter | None] = ContextVar("pii_collected", default=None)


def start_collecting() -> Counter:
    counts: Counter = Counter()
    _collected.set(counts)
    return counts


def collected() -> Counter:
    return _collected.get() or Counter()


def mode() -> str:
    """`redact` (default) replaces PII and continues; `block` rejects the request."""
    value = os.getenv("GHOST_PII_MODE", "redact").strip().lower()
    return value if value in {"redact", "block"} else "redact"


def guard_input(text: str) -> str:
    """Pydantic validator for free-text input fields: always store the redacted form."""
    clean, found = redact_text(text)
    if found and (bucket := _collected.get()) is not None:
        bucket.update(found)
    return clean


def summary(counts: Counter) -> dict:
    return {"kinds": dict(sorted(counts.items())), "total": sum(counts.values())}

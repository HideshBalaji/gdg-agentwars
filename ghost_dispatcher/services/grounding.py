"""Groundedness / truthfulness check for agent replies. Deterministic, no LLM.

Every checkable claim in a reply (record IDs, rupee amounts, clock times,
durations, distances and booking/rescue status words) must be backed by the
tool results and incident state of the same turn. Used at runtime on every
agent reply and as an ADK custom eval metric (see ghost_dispatcher/evaluation).
"""

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

_ID = re.compile(r"(?<![\w-])[A-Z]{2,6}-\d{2,4}(?:-\d{2,4})?(?![\w-])")
_AMOUNT = r"(\d+(?:,\d+)*(?:\.\d+)?)"
_MONEY = re.compile(rf"(?:₹|\bINR|\bRs\.?)\s?{_AMOUNT}|{_AMOUNT}\s?(?:INR|rupees)\b", re.IGNORECASE)
_TIME = re.compile(r"(?<![\w:])([01]\d|2[0-3]):([0-5]\d)(?![\w:])")
_MINUTES = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s?(?:min|mins|minutes)\b", re.IGNORECASE)
_KM = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s?km\b", re.IGNORECASE)
_ISO_TIME = re.compile(r"T(\d{2}):(\d{2})")
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
_NEGATION = re.compile(r"\b(?:not|no|never|un|without|pending|awaiting)\b[\w\s]{0,12}$", re.IGNORECASE)
_STATUS = {
    "confirmed": re.compile(r"\b(?:booked|booking (?:is )?confirmed|confirmed)\b", re.IGNORECASE),
    "resolved": re.compile(r"\b(?:resolved|rescued|rescue (?:is )?complete(?:d)?)\b", re.IGNORECASE),
}
_STATUS_EVIDENCE = {"confirmed": {"confirmed"}, "resolved": {"resolved"}}


@dataclass
class Claim:
    kind: str
    value: str
    supported: bool


@dataclass
class GroundingResult:
    claims: list[Claim] = field(default_factory=list)

    @property
    def unsupported(self) -> list[Claim]:
        return [c for c in self.claims if not c.supported]

    @property
    def score(self) -> float:
        return 1.0 if not self.claims else sum(c.supported for c in self.claims) / len(self.claims)

    @property
    def grounded(self) -> bool:
        return not self.unsupported

    def to_dict(self) -> dict:
        return {
            "score": round(self.score, 3),
            "grounded": self.grounded,
            "claims": len(self.claims),
            "unsupported": [asdict(c) for c in self.unsupported],
        }


class Corpus:
    """Everything the agent could legitimately know this turn."""

    def __init__(self, evidence: list[Any]):
        self.strings: set[str] = set()
        self.numbers: set[float] = set()
        self.times: set[str] = set()
        for item in evidence:
            self._walk(item)
        text = " ".join(self.strings)
        self.ids = set(_ID.findall(text))
        self.times |= {f"{h}:{m}" for h, m in _ISO_TIME.findall(text)}
        self.times |= {f"{h}:{m}" for h, m in _TIME.findall(text)}
        self.status_words = {s.lower() for s in self.strings if s.lower() in {"confirmed", "resolved", "pending", "executing"}}

    def _walk(self, value: Any):
        if isinstance(value, dict):
            for k, v in value.items():
                self.strings.add(str(k))
                self._walk(v)
        elif isinstance(value, (list, tuple, set)):
            for v in value:
                self._walk(v)
        elif isinstance(value, bool) or value is None:
            return
        elif isinstance(value, (int, float)):
            self.numbers.add(float(value))
        else:
            text = str(value)
            if text.startswith(("{", "[")):
                try:
                    return self._walk(json.loads(text))
                except ValueError:
                    pass
            self.strings.add(text)
            self.numbers.update(float(n) for n in _NUMBER.findall(text.replace(",", "")))

    def has_number(self, value: float) -> bool:
        return any(abs(value - n) < 0.51 for n in self.numbers)


def _num(text: str) -> float:
    return float(text.replace(",", ""))


def extract_claims(text: str) -> list[tuple[str, str]]:
    claims: list[tuple[str, str]] = []
    claims += [("id", m) for m in dict.fromkeys(_ID.findall(text))]
    for m in _MONEY.finditer(text):
        claims.append(("money", m.group(1) or m.group(2)))
    claims += [("time", f"{h}:{mm}") for h, mm in _TIME.findall(text)]
    claims += [("minutes", m) for m in _MINUTES.findall(text)]
    claims += [("km", m) for m in _KM.findall(text)]
    for status, pattern in _STATUS.items():
        for m in pattern.finditer(text):
            if not _NEGATION.search(text[: m.start()]):
                claims.append(("status", status))
                break
    return list(dict.fromkeys(claims))


def check(text: str, evidence: list[Any]) -> GroundingResult:
    corpus = Corpus(evidence)
    result = GroundingResult()
    for kind, value in extract_claims(text or ""):
        if kind == "id":
            ok = value in corpus.ids or value in corpus.strings
        elif kind in {"money", "minutes", "km"}:
            ok = corpus.has_number(_num(value))
        elif kind == "time":
            ok = value in corpus.times
        else:
            ok = bool(_STATUS_EVIDENCE[value] & corpus.status_words)
        result.claims.append(Claim(kind, value, ok))
    return result

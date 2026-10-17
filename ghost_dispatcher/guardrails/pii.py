"""Personal-information detection. Findings carry the type and span only, never the value."""

import base64
import re
import zlib
from dataclasses import dataclass

import httpx
from google.auth.exceptions import GoogleAuthError


@dataclass(frozen=True)
class Finding:
    type: str
    start: int
    end: int


# Word-ish boundaries keep identifiers such as TN-07, SHP-001 or hex IDs from matching.
_B = r"(?<![\w+@])"
_E = r"(?![\w@])"
_PATTERNS = {
    "EMAIL_ADDRESS": re.compile(
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"
    ),
    "PHONE_NUMBER": re.compile(
        _B
        + r"(?:"
        + r"(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}"  # Indian mobile
        + r"|\+\d{1,3}[\s-]?(?:\d[\s-]?){6,12}\d"  # international with country code
        + r"|\(?0\d{2,4}\)?[\s-]\d{6,8}"  # landline with trunk prefix
        + r"|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}"  # North American
        + r")"
        + _E
    ),
    "AADHAAR_NUMBER": re.compile(_B + r"[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}" + _E),
    "PAN_NUMBER": re.compile(_B + r"[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]" + _E),
    "CREDIT_CARD_NUMBER": re.compile(_B + r"(?:\d[ -]?){12,18}\d" + _E),
    "VEHICLE_REGISTRATION": re.compile(
        _B + r"[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}" + _E
    ),
    "PERSON_NAME": re.compile(
        r"\b(?i:my name is|name is|i am|i'm|call me|contact person is|"
        r"(?:driver|customer|receiver|contact)(?:'s)? name(?: is|:)?|mr\.?|mrs\.?|ms\.?|dr\.?|"
        r"shri|smt\.?)\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}"
    ),
    "STREET_ADDRESS": re.compile(
        r"\b(?i:(?:house|flat|door|plot|apartment)\s*(?:no\.?|number|#)\s*[\w/-]+"
        r"|(?:pin\s?code|pincode|postal code|zip code)\s*[:\-]?\s*\d{5,6})\b"
    ),
    "DATE_OF_BIRTH": re.compile(
        r"\b(?i:dob|date of birth|born on)\s*[:\-]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b"
    ),
}

# Structured fields that only ever hold personal data. Business names (carriers, hubs) are
# deliberately not listed; free-text values are still scanned by the patterns above.
SENSITIVE_KEYS = frozenset(
    {
        "display_name",
        "driver_name",
        "customer_name",
        "contact_name",
        "contact_email",
        "email",
        "phone",
        "phone_number",
        "mobile",
        "address",
        "home_address",
        "recipient",
        "demo_recipient",
        "date_of_birth",
    }
)

_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def _verhoeff_valid(digits):
    check = 0
    for i, digit in enumerate(reversed(digits)):
        check = _VERHOEFF_D[check][_VERHOEFF_P[i % 8][int(digit)]]
    return check == 0


def _luhn_valid(digits):
    total = 0
    for i, digit in enumerate(reversed(digits)):
        value = int(digit)
        if i % 2:
            value = value * 2 - 9 if value > 4 else value * 2
        total += value
    return total % 10 == 0


def _validated(kind, value):
    digits = re.sub(r"\D", "", value)
    if kind == "AADHAAR_NUMBER":
        return len(digits) == 12 and _verhoeff_valid(digits)
    if kind == "CREDIT_CARD_NUMBER":
        return 13 <= len(digits) <= 19 and _luhn_valid(digits)
    return True


def _merge(findings):
    merged = []
    for finding in sorted(findings, key=lambda f: (f.start, -f.end)):
        if merged and finding.start < merged[-1].end:
            if finding.end > merged[-1].end:
                merged[-1] = Finding(merged[-1].type, merged[-1].start, finding.end)
            continue
        merged.append(finding)
    return merged


class RegexDetector:
    """Deterministic offline detector: emails, phones, government IDs, cards, plates, names,
    addresses and dates of birth. Checksums (Verhoeff, Luhn) cut false positives."""

    name = "regex"

    def scan(self, text):
        findings = [
            Finding(kind, match.start(), match.end())
            for kind, pattern in _PATTERNS.items()
            for match in pattern.finditer(text)
            if _validated(kind, match.group())
        ]
        return _merge(findings)


class DlpDetector:
    """Google Cloud Sensitive Data Protection (DLP) inspection, with the regex detector as
    both a fallback and a floor so a DLP outage never lets personal data through."""

    name = "dlp"
    INFO_TYPES = (
        "PERSON_NAME",
        "EMAIL_ADDRESS",
        "PHONE_NUMBER",
        "STREET_ADDRESS",
        "DATE_OF_BIRTH",
        "CREDIT_CARD_NUMBER",
        "INDIA_AADHAAR_INDIVIDUAL",
        "INDIA_PAN_INDIVIDUAL",
        "PASSPORT",
    )

    def __init__(self, project, transport=None, credentials=None):
        self.project, self.transport, self.credentials = project, transport, credentials
        self.fallback = RegexDetector()
        self.degraded = False

    def _token(self):
        if self.credentials is None:
            import google.auth

            self.credentials, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
        if not self.credentials.valid:
            from google.auth.transport.requests import Request

            self.credentials.refresh(Request())
        return self.credentials.token

    def scan(self, text):
        floor = self.fallback.scan(text)
        if not text.strip():
            return floor
        try:
            with httpx.Client(timeout=5, transport=self.transport) as client:
                response = client.post(
                    f"https://dlp.googleapis.com/v2/projects/{self.project}/content:inspect",
                    headers={"Authorization": f"Bearer {self._token()}"},
                    json={
                        "item": {"value": text},
                        "inspectConfig": {
                            "infoTypes": [{"name": name} for name in self.INFO_TYPES],
                            "minLikelihood": "LIKELY",
                            "includeQuote": False,
                        },
                    },
                )
                response.raise_for_status()
        except (httpx.HTTPError, GoogleAuthError, OSError, ValueError):
            self.degraded = True
            return floor
        self.degraded = False
        found = []
        for item in response.json().get("result", {}).get("findings", []):
            span = item.get("location", {}).get("codepointRange", {})
            if "end" in span:
                found.append(
                    Finding(item["infoType"]["name"], int(span.get("start", 0)), int(span["end"]))
                )
        return _merge(found + floor)


def redact_text(detector, text):
    findings = detector.scan(text)
    for finding in reversed(findings):
        text = text[: finding.start] + f"[REDACTED:{finding.type}]" + text[finding.end :]
    return text, [finding.type for finding in findings]


def redact_data(detector, value):
    """Recursively redact a JSON-like value. Returns (value, finding types)."""
    if isinstance(value, str):
        return redact_text(detector, value)
    if isinstance(value, list):
        types, items = [], []
        for item in value:
            redacted, found = redact_data(detector, item)
            items.append(redacted)
            types += found
        return items, types
    if isinstance(value, dict):
        types, result = [], {}
        for key, item in value.items():
            if key in SENSITIVE_KEYS and item not in (None, "", [], {}):
                result[key] = f"[REDACTED:{key.upper()}]"
                types.append(f"FIELD:{key}")
                continue
            result[key], found = redact_data(detector, item)
            types += found
        return result, types
    return value, []


def pdf_text(raw: bytes) -> str:
    """Best-effort text layer of a PDF (Flate and ASCII85+Flate streams, Tj/TJ strings)."""
    chunks = []
    for match in re.finditer(rb"stream\r?\n(.*?)endstream", raw, re.DOTALL):
        data = match.group(1).strip()
        try:
            if data.endswith(b"~>"):
                data = base64.a85decode(re.sub(rb"\s", b"", data[:-2]))
            data = zlib.decompress(data)
        except (ValueError, zlib.error):
            continue
        for text in re.findall(rb"\(((?:\\.|[^\\)])*)\)\s*T[jJ]", data):
            chunks.append(text.replace(b"\\(", b"(").replace(b"\\)", b")"))
    return b"\n".join(chunks).decode("latin-1", errors="replace")

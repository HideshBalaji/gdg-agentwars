import pytest

from ghost_dispatcher.evaluation import run
from ghost_dispatcher.models.contracts import Feedback, IncidentCreate, Message
from ghost_dispatcher.services.guardrails import contains_pii, redact, redact_text

PII = [
    ("Call +91 98765 43210", "PHONE"),
    ("ph 9876543210", "PHONE"),
    ("+1 (415) 555-0132", "PHONE"),
    ("Aadhaar 1234 5678 9012", "AADHAAR"),
    ("card 4111 1111 1111 1111", "CARD"),
    ("card 4111-1111-1111-1111", "CARD"),
    ("mail ravi.k@example.com", "EMAIL"),
    ("PAN ABCDE1234F", "PAN"),
    ("upi ravi@okaxis", "UPI"),
]

SAFE = [
    "TN-07 SHP-001 CAR-002 DOCK-CHENNAI-001 INC-0217 HUB-003",
    "4a883c47c65640e592cb0c54e5b9504e-CAR-002",
    "2026-10-17T07:35:00+05:30",
    "12.716, 77.870",
    "cost 18500.0 INR ₹18,500 · slack 25 min · 340 km",
    "plate TN 07 BX 4471",
    "event id 1792234669720",
    "[REDACTED:PHONE] was already removed",
]


@pytest.mark.parametrize(("text", "kind"), PII)
def test_detects_personal_data(text, kind):
    clean, counts = redact_text(text)
    assert counts == {kind: 1}
    assert f"[REDACTED:{kind}]" in clean


@pytest.mark.parametrize("text", SAFE)
def test_leaves_operational_data_alone(text):
    assert redact_text(text) == (text, {})


def test_deep_redaction_keeps_structure():
    data = {"a": ["call +91 98765 43210", 3, None], "b": {"c": "ok", "d": "x@example.com"}}
    assert redact(data) == {"a": ["call [REDACTED:PHONE]", 3, None], "b": {"c": "ok", "d": "[REDACTED:EMAIL]"}}
    assert not contains_pii(redact(data))


def test_contracts_redact_free_text_on_parse():
    pii = "phone +91 98765 43210, card 4111 1111 1111 1111"
    assert not contains_pii(IncidentCreate(shipment_id="SHP-001", type="truck_breakdown", description=pii).description)
    assert not contains_pii(Message(text=pii).text)
    assert not contains_pii(Feedback(rating="down", reason=pii).reason)


def test_no_pii_reaches_api_events_or_storage_and_block_mode_rejects():
    result = run.pii_end_to_end()
    assert result["leaks"] == []
    assert result["checks"]["redaction_recorded"]
    assert result["checks"]["block_mode_rejects"]
    assert result["checks"]["block_mode_allows_clean"]


def test_api_reports_redactions(client):
    response = client.post(
        "/api/incidents",
        json={"shipment_id": "SHIP-1", "type": "truck_breakdown", "description": "Driver +91 98765 43210"},
    )
    assert response.status_code == 201
    assert response.json()["description"] == "Driver [REDACTED:PHONE]"
    assert response.headers["x-pii-redacted"] == "PHONE=1"
    events = client.get(f"/api/incidents/{response.json()['id']}/events").text
    assert "event: guardrail" in events and "98765" not in events
    assert client.get("/health").json()["pii_mode"] == "redact"

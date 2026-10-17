from pathlib import Path
from types import SimpleNamespace

# Synthetic values: a Verhoeff-valid Aadhaar, a Luhn-valid test card, a reserved-domain email.
PHONE = "+91 98765 43210"
AADHAAR = "2345 6789 0124"
CARD = "4111 1111 1111 1111"
EMAIL = "test.driver@example.com"
RAW = (PHONE, AADHAAR, CARD, EMAIL)


def stored_bytes(settings):
    database = Path(settings.database)
    return b"".join(path.read_bytes() for path in database.parent.glob(database.name + "*"))


def test_personal_information_is_redacted_not_refused(client, settings):
    text = f"Driver phone {PHONE}, Aadhaar {AADHAAR}, card {CARD}, email {EMAIL}"
    response = client.post(
        "/api/incidents",
        json={"shipment_id": "SHIP-1", "type": "truck_breakdown", "description": text},
    )
    assert response.status_code == 201
    incident = response.json()
    for marker in ("PHONE_NUMBER", "AADHAAR_NUMBER", "CREDIT_CARD_NUMBER", "EMAIL_ADDRESS"):
        assert f"[REDACTED:{marker}]" in incident["description"]

    conversation = client.post("/api/conversations", json={"incident_id": incident["id"]})
    reply = client.post(
        f"/api/conversations/{conversation.json()['id']}/messages",
        json={"text": f"Call me on {PHONE} and plan a rescue"},
    )
    assert reply.status_code == 200
    feedback = client.post(
        f"/api/incidents/{incident['id']}/feedback",
        json={"rating": "down", "reason": f"Too expensive, card {CARD}"},
    )
    assert feedback.status_code == 201
    assert "[REDACTED:CREDIT_CARD_NUMBER]" in feedback.json()["reason"]

    events = client.get(f"/api/incidents/{incident['id']}/events").text
    log = client.get("/api/guardrails").json()["log"]
    assert {entry["surface"] for entry in log} >= {"incident_description", "chat", "feedback"}
    assert {entry["action"] for entry in log} == {"redacted"}
    kept = stored_bytes(settings)
    for value in RAW:
        assert value not in events
        assert value not in str(log)
        assert value.encode() not in kept


def test_logistics_identifiers_are_left_alone(service):
    text = "TN-07 via CAR-001 for SHP-001, DRV-007, INR 18,500, arrives 02:35, 420 kg"
    assert service.guardrails.redact_input(text, surface="chat") == text
    assert service.guardrails.log() == []


def test_tool_arguments_are_redacted_and_the_tool_still_runs(service, incident):
    args = {"reason": f"Ring {PHONE}", "rating": "down"}
    context = SimpleNamespace(state={"incident_id": incident.id})
    result = service.guardrails.before_tool(SimpleNamespace(name="record_feedback"), args, context)
    assert result is None
    assert args == {"reason": "Ring [REDACTED:PHONE_NUMBER]", "rating": "down"}
    assert service.guardrails.log()[0]["surface"] == "tool_args:record_feedback"

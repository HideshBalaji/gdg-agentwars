import asyncio

from ghost_dispatcher.agents.conversations import Conversations
from ghost_dispatcher.evaluation import run
from ghost_dispatcher.services.grounding import check, extract_claims

PLAN = {
    "candidates": [{"truck_id": "TN-02", "carrier_id": "CAR-001", "cost": 18500.0, "arrival": "2026-10-17T07:35:00+05:30", "slack_minutes": 25.0}],
    "status": "planned",
}


def test_extracts_checkable_claims():
    claims = extract_claims("TN-02 via CAR-001 costs ₹18,500, arrives 07:35, 25 min slack. Booked.")
    assert ("id", "TN-02") in claims and ("money", "18,500") in claims
    assert ("time", "07:35") in claims and ("minutes", "25") in claims
    assert ("status", "confirmed") in claims


def test_supported_and_unsupported_claims():
    assert check("TN-02 via CAR-001 costs ₹18,500 and arrives 07:35.", [PLAN]).grounded
    bad = check("TN-09 via CAR-007 costs ₹9,999 and arrives 06:10.", [PLAN])
    assert not bad.grounded and bad.score == 0
    assert {c.value for c in bad.unsupported} == {"TN-09", "CAR-007", "9,999", "06:10"}


def test_status_claims_need_evidence_and_respect_negation():
    assert not check("Booked TN-02.", [PLAN]).grounded
    assert check("TN-02 is not booked yet.", [PLAN]).grounded
    assert check("Booking confirmed for TN-02.", [PLAN, {"status": "confirmed"}]).grounded


def test_labelled_set_is_classified_perfectly():
    result = run.grounding_labelled()
    assert result["accuracy"] == 1.0, result["mismatches"]


def test_runtime_flags_unverified_replies(service, incident):
    conversations = Conversations(service)
    try:
        reply = conversations._grounded(incident.id, "route_risk", "Booked TN-99 for ₹1.", [PLAN])
        assert not reply["grounding"]["grounded"]
        assert "[Guardrail] Not backed by tool results" in reply["text"]
        ok = conversations._grounded(incident.id, "route_risk", "TN-02 costs ₹18,500.", [PLAN])
        assert ok["grounding"]["grounded"] and "[Guardrail]" not in ok["text"]
    finally:
        asyncio.run(conversations.close())


def test_every_reply_in_a_conversation_is_grounded():
    result = run.scenario_grounding()
    assert result["replies"] >= 6 and result["min_score"] == 1.0, result["details"]

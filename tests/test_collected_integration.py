import asyncio
from dataclasses import replace
from pathlib import Path

from ghost_dispatcher.models.contracts import Feedback, IncidentCreate
from ghost_dispatcher.services.dispatcher import DispatcherService

DATA = Path(__file__).resolve().parents[1] / "data"


def collected(settings):
    service = DispatcherService(replace(settings, dataset="collected", data_dir=str(DATA)))
    service.bootstrap()
    incident = service.create_incident(
        IncidentCreate(
            shipment_id="SHP-001",
            type="truck_breakdown",
            description="Collected synthetic breakdown",
        )
    )
    return service, incident


def test_collected_data_separates_cold_restoration_and_delivery(settings):
    service, incident = collected(settings)
    plan = asyncio.run(service.plan(incident.id))
    assert len(service.fleet()["trucks"]) == 10
    assert len(service.fleet()["shipments"]) == 20
    assert plan.chosen.truck_id == "TN-02"
    assert plan.chosen.cost == 18500
    assert plan.chosen.cold_restore_at.isoformat().endswith("02:35:00+05:30")
    assert plan.chosen.arrival.isoformat().endswith("07:35:00+05:30")
    assert plan.deadline.hour == 3
    assert {c.truck_id for c in plan.candidates} == {"TN-02", "TN-03"}


def test_collected_feedback_uses_documented_cost_delay_policy(settings):
    service, incident = collected(settings)
    baseline = asyncio.run(service.plan(incident.id))
    service.feedback(
        incident.id,
        Feedback(
            rating="down",
            reason="Prefer cheaper within agreed limits",
            prefer_cheaper_when_slack=True,
        ),
    )
    learned = asyncio.run(service.plan(incident.id))
    assert learned.chosen.truck_id == "TN-03"
    assert learned.chosen.cost == 12000
    assert baseline.chosen.cost - learned.chosen.cost == 6500
    assert (learned.chosen.arrival - baseline.chosen.arrival).total_seconds() / 60 == 75
    assert learned.chosen.slack_minutes < 60
    assert learned.chosen.cold_restore_at <= learned.deadline


def test_collected_transfer_conserves_mass_and_preserves_other_cargo(settings):
    service, incident = collected(settings)
    result = asyncio.run(service.execute(incident.id))
    assert result.status == "resolved"
    assert service.store.get("truck", "TN-07")["available_capacity_kg"] == 1600
    assert service.store.get("truck", "TN-02")["available_capacity_kg"] == 700
    assert service.store.get("shipment", "SHP-002")["truck_id"] == "TN-07"
    active = [
        a
        for a in service.store.list("assignment")
        if a["shipment_id"] == "SHP-001" and a["status"] == "active"
    ]
    assert len(active) == 1
    assert active[0]["truck_id"] == "TN-02"
    assert service.store.get("assignment", "ASN-001")["status"] == "ended"


def test_collected_outage_fallback_is_executed_not_assumed(settings):
    service, incident = collected(settings)
    asyncio.run(service.plan(incident.id))
    service.carriers.health("CAR-001", False)
    result = asyncio.run(service.execute(incident.id))
    assert result.plan.chosen.truck_id == "TN-03"
    assert result.actions["booking"]["status"] == "confirmed"
    assert result.actions["booking"]["simulated"] is True

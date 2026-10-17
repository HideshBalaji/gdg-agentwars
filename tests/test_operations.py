import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from ghost_dispatcher.models.contracts import Feedback, IncidentCreate, Seed, Shipment, Truck
from ghost_dispatcher.services.demo_seed import demo_seed
from ghost_dispatcher.services.dispatcher import DispatcherService
from ghost_dispatcher.services.store import DomainError
from ghost_dispatcher.services.validation import rescue_deadline


def operational_snapshot(service):
    fleet = service.fleet()
    return {key: fleet[key] for key in ("trucks", "shipments", "warehouses")}


def test_failure_fallback_and_idempotent_execution(service, incident):
    async def scenario():
        plan = await service.plan(incident.id)
        assert plan.chosen.carrier_id == "primary"
        service.carriers.health("primary", False)
        result = await service.execute(incident.id)
        assert result.status == "resolved"
        assert result.plan.chosen.carrier_id == "backup"
        before = operational_snapshot(service)
        again = await service.execute(incident.id)
        assert again == result
        assert operational_snapshot(service) == before
        assert len(service.store.list("booking")) == 1
        events = service.store.events(incident.id)
        assert sum(e.type == "action.completed" for e in events) == 1
        assert any(e.type == "healing" and e.data.get("level") == "fallback" for e in events)

    asyncio.run(scenario())


def test_feedback_changes_feasible_choice_not_constraints(service, incident):
    async def scenario():
        baseline = await service.plan(incident.id)
        service.feedback(
            incident.id,
            Feedback(rating="down", reason="Too expensive", prefer_cheaper_when_slack=True),
        )
        new = await service.plan(incident.id)
        assert new.chosen.carrier_id == "backup"
        assert new.chosen.cost < baseline.chosen.cost
        assert new.chosen.dock_time < new.deadline
        assert "Learned preference" in new.reason

    asyncio.run(scenario())


def test_insufficient_capacity_cannot_be_planned(service, incident):
    for truck in service.store.list("truck"):
        truck["available_capacity_kg"] = 0
        service.store.put("truck", truck["id"], truck)
    with pytest.raises(DomainError, match="No feasible"):
        asyncio.run(service.plan(incident.id))
    assert not service.store.list("booking")


def test_stale_plan_rejected_before_booking(service, incident):
    asyncio.run(service.plan(incident.id))
    current = service.incident(incident.id)
    current.plan.created_at = datetime.now(UTC) - timedelta(minutes=6)
    service.save(current)
    with pytest.raises(DomainError, match="expired"):
        asyncio.run(service.execute(incident.id))
    assert not service.store.list("booking")


def test_changed_capacity_rejected_before_booking(service, incident):
    plan = asyncio.run(service.plan(incident.id))
    truck = service.store.get("truck", plan.chosen.truck_id)
    truck["available_capacity_kg"] = 0
    service.store.put("truck", truck["id"], truck)
    with pytest.raises(DomainError, match="capacity"):
        asyncio.run(service.execute(incident.id))
    assert not service.store.list("booking")


def test_sync_outage_resumes_without_duplicate_assignment(service, incident, monkeypatch):
    from ghost_dispatcher.tools.google import GoogleTools

    original = GoogleTools.synchronize

    async def fail(*args):
        raise TimeoutError("Temporary outage")

    monkeypatch.setattr(GoogleTools, "synchronize", fail)
    with pytest.raises(DomainError, match="synchronization pending"):
        asyncio.run(service.execute(incident.id))
    before = operational_snapshot(service)
    assert service.incident(incident.id).status == "executing"
    monkeypatch.setattr(GoogleTools, "synchronize", original)
    assert asyncio.run(service.execute(incident.id)).status == "resolved"
    assert operational_snapshot(service) == before
    assert len(service.store.list("booking")) == 1


def test_concurrent_repeat_executes_once(service, incident):
    async def scenario():
        results = await asyncio.gather(service.execute(incident.id), service.execute(incident.id))
        assert results[0] == results[1]
        assert len(service.store.list("booking")) == 1

    asyncio.run(scenario())


def test_booking_key_cannot_be_reused_for_other_cargo(service):
    payload = {
        "id": "stable-key",
        "carrier_id": "primary",
        "shipment_id": "SHIP-1",
        "truck_id": "TN-08",
    }
    service.carriers.mock_book(payload)
    with pytest.raises(DomainError, match="key already used"):
        service.carriers.mock_book({**payload, "shipment_id": "SHIP-2"})


def test_sensor_stale_and_excursion_start_unknown():
    now = datetime.now(UTC)
    seed = demo_seed(now)
    shipment, truck = seed.shipments[0], seed.trucks[0]
    with pytest.raises(DomainError, match="last 15 minutes"):
        rescue_deadline(shipment, truck, now + timedelta(minutes=30))
    for reading in truck.temperature_history:
        reading.temp_c = 9
    with pytest.raises(DomainError, match="excursion start"):
        rescue_deadline(shipment, truck, now)


def test_flat_readings_do_not_create_unlimited_window():
    now = datetime.now(UTC)
    seed = demo_seed(now)
    for reading in seed.trucks[0].temperature_history:
        reading.temp_c = 5
    assert rescue_deadline(seed.shipments[0], seed.trucks[0], now) == now + timedelta(minutes=240)


def test_seed_contract_rejects_unknown_references():
    value = demo_seed().model_dump(mode="json")
    value["shipments"][0]["truck_id"] = "unknown"
    with pytest.raises(ValueError, match="unknown truck"):
        Seed.model_validate(value)


def test_storage_survives_service_restart(settings, service, incident):
    asyncio.run(service.execute(incident.id))
    restarted = DispatcherService(settings)
    assert restarted.incident(incident.id).status == "resolved"
    assert len(restarted.store.list("booking")) == 1


def test_unknown_incident_and_extra_workflows_rejected(service):
    with pytest.raises(DomainError, match="Unknown incident"):
        service.incident("missing")
    i = service.create_incident(
        IncidentCreate(
            shipment_id="SHIP-1",
            type="damaged_delivery",
            description="Damage discussion requires operator",
        )
    )
    with pytest.raises(DomainError, match="release plans"):
        asyncio.run(service.plan(i.id))


def test_temperature_bounds_are_validated():
    raw = demo_seed().shipments[0].model_dump(mode="json")
    raw["temp_max_c"] = 0
    with pytest.raises(ValueError, match="minimum"):
        Shipment.model_validate(raw)
    raw = demo_seed().trucks[0].model_dump(mode="json")
    raw["available_capacity_kg"] = raw["capacity_kg"] + 1
    with pytest.raises(ValueError, match="Available capacity"):
        Truck.model_validate(raw)

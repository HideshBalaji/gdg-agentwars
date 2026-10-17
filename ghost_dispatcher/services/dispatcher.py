import asyncio
import json
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from uuid import uuid4

from ghost_dispatcher.models.contracts import (
    Candidate,
    Carrier,
    Feedback,
    Incident,
    IncidentCreate,
    Plan,
    Seed,
    Shipment,
    Truck,
    Warehouse,
)
from ghost_dispatcher.services.demo_seed import demo_seed
from ghost_dispatcher.services.recovery import CarrierUnavailable, Recovery
from ghost_dispatcher.services.store import DomainError, Store
from ghost_dispatcher.services.validation import distance_km, rescue_deadline, violations
from ghost_dispatcher.tools.carriers import CarrierGateway
from ghost_dispatcher.tools.routing import Router


class DispatcherService:
    def __init__(self, settings, store=None):
        self.settings = settings
        self.store = store or Store(settings.database)
        self.router = Router(settings)
        self.carriers = CarrierGateway(settings, self.store)
        self.recovery = Recovery(self.store)
        self._locks = {}
        self._replay_at = None
        self._dataset = "builtin"

    def now(self):
        if self.settings.mode == "offline" and self._replay_at is not None:
            return self._replay_at
        return datetime.now(UTC)

    def bootstrap(self):
        if self.store.list("shipment"):
            try:
                metadata = self.store.get("dataset", "source")
            except DomainError as error:
                raise ValueError(
                    "This database predates dataset metadata; use a fresh GHOST_DATABASE"
                ) from error
            expected = "custom" if self.settings.seed_file else self.settings.dataset
            if metadata["dataset"] != expected:
                raise ValueError("Use a fresh GHOST_DATABASE when switching datasets")
            self._dataset = metadata["dataset"]
            if self._dataset == "collected":
                if metadata["mode"] != self.settings.mode:
                    raise ValueError("Use a fresh GHOST_DATABASE when switching replay/live modes")
                self._replay_at = datetime.fromisoformat(metadata["clock"])
            return
        quotes, assignments, policy = [], [], None
        if self.settings.seed_file:
            seed = Seed.model_validate_json(Path(self.settings.seed_file).read_text())
            metadata = {"dataset": "custom"}
        elif self.settings.dataset == "collected":
            from ghost_dispatcher.services.collected_seed import collected_seed

            seed, metadata, quotes, assignments, policy = collected_seed(self.settings)
            self._replay_at = datetime.fromisoformat(metadata["clock"])
        elif self.settings.mode == "offline":
            seed = demo_seed()
            metadata = {"dataset": "builtin"}
        else:
            raise ValueError("Live mode requires an explicit GHOST_SEED_FILE")
        self._dataset = metadata["dataset"]
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            for kind, items in (
                ("truck", seed.trucks),
                ("shipment", seed.shipments),
                ("carrier", seed.carriers),
                ("warehouse", seed.warehouses),
            ):
                for item in items:
                    self.store.put(kind, item.id, item.model_dump(mode="json"), db)
            self.store.put("dataset", "source", metadata, db)
            for row in quotes:
                self.store.put("route_quote", row["option_id"], row, db)
            for row in assignments:
                self.store.put(
                    "assignment", row["assignment_id"], {**row, "id": row["assignment_id"]}, db
                )
            if policy:
                self.store.put("policy", "feedback", policy, db)
                self.store.put("health", "CAR-003", {"id": "CAR-003", "alive": False}, db)

    # Operational state rebuilt by a demo reset. Preferences, feedback, incidents,
    # conversations and evidence are kept so a rating still applies afterwards.
    RESETTABLE = (
        "truck",
        "shipment",
        "carrier",
        "warehouse",
        "dataset",
        "route_quote",
        "assignment",
        "policy",
        "health",
        "circuit",
        "booking",
        "google_receipt",
        "sync_job",
    )

    def reset_demo(self):
        """Offline only: restore the seeded fleet so a comparable incident can be replayed."""
        if self.settings.mode != "offline":
            raise DomainError("forbidden", "Demo reset is only available in offline mode", 403)
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            removed = self.store.delete_kinds(self.RESETTABLE, db)
        self._locks.clear()
        self._replay_at = None
        self.bootstrap()
        return {
            "reset": True,
            "removed_records": removed,
            "kept": {
                "preferences": len(self.store.list("preference")),
                "incidents": len(self.store.list("incident")),
            },
            "decision_clock": self.now().isoformat(),
            "simulated": True,
        }

    def incident(self, incident_id):
        return Incident.model_validate(self.store.get("incident", incident_id))

    def save(self, incident):
        self.store.put("incident", incident.id, incident.model_dump(mode="json"))

    def create_incident(self, request: IncidentCreate):
        self.store.get("shipment", request.shipment_id)
        for evidence_id in request.evidence_ids:
            self.store.get("evidence", evidence_id)
        incident = Incident(**request.model_dump(), id=uuid4().hex, created_at=self.now())
        self.save(incident)
        self.store.emit(incident.id, "incident.created", incident.model_dump(mode="json"))
        return incident

    def fleet(self):
        return {
            "trucks": self.store.list("truck"),
            "shipments": self.store.list("shipment"),
            "carriers": self.store.list("carrier"),
            "warehouses": self.store.list("warehouse"),
            "simulated": self.settings.mode == "offline",
            "dataset": self._dataset,
            "decision_clock": self.now().isoformat(),
        }

    def trucks_near(self, lat, lng, radius_km, needs_reefer=True):
        from ghost_dispatcher.models.contracts import Location

        location = Location(lat=lat, lng=lng)
        return [
            t.model_dump(mode="json")
            for row in self.store.list("truck")
            if (t := Truck.model_validate(row)).status == "available"
            and (t.reefer or not needs_reefer)
            and distance_km(t.location, location) <= radius_km
        ]

    async def plan(self, incident_id, excluded_carriers=()):
        lock = self._locks.setdefault(incident_id, asyncio.Lock())
        async with lock:
            return await self._plan(incident_id, excluded_carriers)

    async def _plan(self, incident_id, excluded_carriers=()):
        incident = self.incident(incident_id)
        if incident.status == "resolved":
            return incident.plan
        if incident.status == "executing":
            raise DomainError("action_in_progress", "Resume execution instead of changing its plan")
        if incident.type not in {"truck_breakdown", "fridge_failure"}:
            raise DomainError(
                "unsupported_workflow", "This release plans breakdown/fridge incidents", 422
            )
        shipment = Shipment.model_validate(self.store.get("shipment", incident.shipment_id))
        broken = Truck.model_validate(self.store.get("truck", shipment.truck_id))
        warehouse = Warehouse.model_validate(self.store.get("warehouse", shipment.warehouse_id))
        now = self.now()
        deadline = rescue_deadline(shipment, broken, now)
        carriers = {r["id"]: Carrier.model_validate(r) for r in self.store.list("carrier")}
        availability = self.recovery.availability()
        health = {r["id"]: r["alive"] for r in self.store.list("health")}
        quotes = {
            r["truck_id"]: r
            for r in self.store.list("route_quote")
            if r["shipment_id"] == shipment.id
        }
        candidates, rejected = [], []
        for row in self.store.list("truck"):
            truck = Truck.model_validate(row)
            if (
                truck.id == shipment.truck_id
                or truck.status != "available"
                or not truck.reefer
                or truck.available_capacity_kg < shipment.weight_kg
                or truck.carrier_id in excluded_carriers
                or not availability.get(truck.carrier_id, True)
                or not health.get(truck.carrier_id, True)
            ):
                continue
            if self.settings.mode == "offline" and self._dataset == "collected":
                if truck.id not in quotes:
                    rejected.append({"truck_id": truck.id, "reason": "No collected route quote"})
                    continue
                quote = quotes[truck.id]
                pickup_minutes, drive_minutes = quote["pickup_eta_min"], quote["loaded_drive_min"]
                km, cost, source = (
                    quote["rescue_route_km"],
                    quote["cost"]["amount"],
                    "collected_simulation",
                )
            else:
                pickup = await self.router.leg(truck.location, broken.location)
                delivery = await self.router.leg(broken.location, shipment.destination)
                pickup_minutes, drive_minutes = pickup["minutes"], delivery["minutes"]
                km, source = pickup["km"] + delivery["km"], pickup["source"]
                if truck.pricing is not None:
                    cost = max(
                        truck.pricing["minimum"],
                        truck.pricing["base"] + truck.pricing["per_km"] * km,
                    )
                elif carriers[truck.carrier_id].cost_per_km is not None:
                    cost = km * carriers[truck.carrier_id].cost_per_km
                else:
                    raise DomainError("quote_missing", "Carrier/truck has no pricing")
            travel = pickup_minutes + drive_minutes
            restored = now + timedelta(minutes=pickup_minutes + shipment.transfer_minutes)
            arrival = restored + timedelta(minutes=drive_minutes + shipment.receiving_minutes)
            dock_time = arrival - timedelta(minutes=shipment.receiving_minutes)
            slots = [slot for slot in warehouse.dock_slots if slot >= dock_time]
            windows = [
                w
                for w in warehouse.dock_windows
                if w.start <= dock_time
                and w.end >= arrival
                and w.reserved_for in (None, shipment.id)
            ]
            if not slots and not windows:
                rejected.append({"truck_id": truck.id, "reason": "No available receiving slot"})
                continue
            if not windows:
                dock_time = min(slots)
                arrival = dock_time + timedelta(minutes=shipment.receiving_minutes)
            candidate = Candidate(
                truck_id=truck.id,
                carrier_id=truck.carrier_id,
                travel_minutes=travel,
                distance_km=round(km, 2),
                arrival=arrival,
                dock_time=dock_time,
                cost=round(cost, 2),
                slack_minutes=(
                    deadline - (restored if shipment.cold_restore_deadline else arrival)
                ).total_seconds()
                / 60,
                route_source=source,
                cold_restore_at=restored,
                duty_minutes=(arrival - now).total_seconds() / 60,
                dock_slot_id=windows[0].id if windows else None,
                currency="INR" if truck.pricing is not None else "demo_units",
            )
            errors = violations(shipment, truck, candidate, deadline, now)
            if errors or warehouse.free_capacity_kg < shipment.weight_kg:
                rejected.append({"truck_id": truck.id, "reason": errors or ["Hub capacity"]})
            else:
                candidates.append(candidate)
        self.store.emit(
            incident_id,
            "validation",
            {
                "rejected": rejected,
                "feasible": len(candidates),
                "deadline": deadline.isoformat(),
                "estimate": "synthetic rescue-window model",
            },
        )
        if not candidates:
            incident.status = "blocked"
            incident.outcome = "No feasible rescue; operator intervention required"
            self.save(incident)
            raise DomainError("no_feasible_plan", incident.outcome)
        preferences = self.store.list("preference")
        economical = any(p["rule"] == "cheapest_when_slack" for p in preferences)
        eligible = [c for c in candidates if c.slack_minutes > 60] if economical else []
        fastest = min(candidates, key=lambda c: (c.cold_restore_at, c.arrival, c.cost))
        for preference in preferences:
            if (
                preference["rule"] == "cost_delay_budget"
                and datetime.fromisoformat(preference["expires_at"]) > now
                and preference["scope"]["customer_id"] == shipment.customer_id
                and preference["scope"]["cargo_profile_id"] == shipment.cargo_profile_id
            ):
                eligible = [
                    c
                    for c in candidates
                    if c.currency == preference["scope"]["currency"]
                    and fastest.cost - c.cost >= preference["min_savings"]
                    and (c.arrival - fastest.arrival).total_seconds() / 60
                    <= preference["max_delay"]
                ]
        chosen = min(eligible, key=lambda c: c.cost) if eligible else fastest
        plan = Plan(
            id=uuid4().hex,
            created_at=now,
            deadline=deadline,
            candidates=candidates,
            chosen=chosen,
            reason=(
                "Learned preference: cheapest feasible carrier within the approved cost/time policy"
                if eligible
                else "Earliest feasible arrival"
            ),
            simulated=self.settings.mode == "offline",
        )
        incident.plan, incident.status = plan, "planned"
        self.save(incident)
        self.store.emit(incident_id, "plan.created", plan.model_dump(mode="json"))
        return plan

    async def execute(self, incident_id):
        lock = self._locks.setdefault(incident_id, asyncio.Lock())
        async with lock:
            incident = self.incident(incident_id)
            if incident.status == "resolved":
                return incident
            if not incident.plan:
                await self._plan(incident_id)
                incident = self.incident(incident_id)
            excluded = []
            for attempt in range(3):
                plan = incident.plan
                if (
                    "assignment" not in incident.actions
                    and (self.now() - plan.created_at).total_seconds() > 300
                ):
                    raise DomainError("stale_plan", "Plan expired; request a fresh plan")
                shipment = Shipment.model_validate(self.store.get("shipment", incident.shipment_id))
                truck = Truck.model_validate(self.store.get("truck", plan.chosen.truck_id))
                if "assignment" not in incident.actions:
                    errors = violations(shipment, truck, plan.chosen, plan.deadline, self.now())
                    if errors:
                        raise DomainError("validation_failed", "; ".join(errors))
                    try:
                        booking = await self.recovery.run(
                            incident_id,
                            plan.chosen.carrier_id,
                            partial(
                                self.carriers.book,
                                plan.chosen.carrier_id,
                                f"{incident_id}-{plan.chosen.carrier_id}",
                                shipment.id,
                                truck.id,
                            ),
                        )
                    except CarrierUnavailable:
                        excluded.append(plan.chosen.carrier_id)
                        self.store.emit(
                            incident_id,
                            "healing",
                            {"level": "fallback", "attempt": attempt + 1, "status": "replanning"},
                        )
                        if attempt == 2:
                            break
                        await self._plan(incident_id, excluded)
                        incident = self.incident(incident_id)
                        continue
                    incident.actions["booking"] = booking
                    incident.status = "executing"
                    self.save(incident)
                    self._assign(incident, shipment, truck)
                    incident = self.incident(incident_id)
                from ghost_dispatcher.tools.google import GoogleTools

                try:
                    result = await GoogleTools(self.settings, self.store).synchronize(incident)
                except Exception as error:
                    # Persist pending work and permit the same execution to resume after recovery.
                    incident.status = "executing"
                    incident.outcome = "Load assigned; Google synchronization pending"
                    self.save(incident)
                    previous = [
                        job
                        for job in self.store.list("sync_job")
                        if job["incident_id"] == incident_id
                    ]
                    attempts = previous[0]["attempts"] + 1 if previous else 1
                    self.store.put(
                        "sync_job",
                        incident_id,
                        {
                            "incident_id": incident_id,
                            "status": "pending" if attempts < 5 else "needs_review",
                            "attempts": attempts,
                            "error_type": type(error).__name__,
                        },
                    )
                    self.store.emit(
                        incident_id, "integration.pending", {"error_type": type(error).__name__}
                    )
                    raise DomainError("sync_pending", incident.outcome, 503) from error
                incident.actions["google"] = result
                incident.status = "resolved"
                incident.outcome = "Simulated rescue completed; not a medical safety determination"
                self.save(incident)
                self.store.put(
                    "sync_job", incident_id, {"incident_id": incident_id, "status": "done"}
                )
                self.store.emit(incident_id, "incident.resolved", incident.model_dump(mode="json"))
                return incident
            incident.status = "blocked"
            incident.outcome = "Carrier booking unavailable; operator confirmation required"
            self.save(incident)
            raise DomainError("carriers_unavailable", incident.outcome, 503)

    async def retry_sync_jobs(self):
        outcomes = []
        for job in self.store.list("sync_job"):
            if job["status"] == "pending":
                try:
                    incident = await self.execute(job["incident_id"])
                    outcomes.append({"incident_id": incident.id, "status": incident.status})
                except DomainError as error:
                    outcomes.append({"incident_id": job["incident_id"], "code": error.code})
        return outcomes

    def _assign(self, incident, shipment, truck):
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            current = Incident.model_validate(self.store.get("incident", incident.id, db))
            if "assignment" in current.actions:
                return
            fresh = Truck.model_validate(self.store.get("truck", truck.id, db))
            current_shipment = Shipment.model_validate(self.store.get("shipment", shipment.id, db))
            if current_shipment.truck_id != shipment.truck_id:
                raise DomainError("shipment_changed", "Shipment assignment changed; review booking")
            if fresh.status != "available" or fresh.available_capacity_kg < shipment.weight_kg:
                raise DomainError(
                    "capacity_changed", "Truck availability changed; booking needs review"
                )
            hub = Warehouse.model_validate(self.store.get("warehouse", shipment.warehouse_id, db))
            slot = incident.plan.chosen.dock_time
            window_id = incident.plan.chosen.dock_slot_id
            windows = [
                w
                for w in hub.dock_windows
                if w.id == window_id
                and w.start <= slot
                and w.end >= incident.plan.chosen.arrival
                and w.reserved_for in (None, shipment.id)
            ]
            if (
                slot not in hub.dock_slots and not windows
            ) or hub.free_capacity_kg < shipment.weight_kg:
                raise DomainError("dock_changed", "Dock capacity changed; booking needs review")
            source = Truck.model_validate(self.store.get("truck", shipment.truck_id, db))
            if source.available_capacity_kg + shipment.weight_kg > source.capacity_kg:
                raise DomainError("mass_inconsistent", "Source mass does not support this transfer")
            source.available_capacity_kg += shipment.weight_kg
            fresh.available_capacity_kg -= shipment.weight_kg
            fresh.status = "assigned"
            shipment.truck_id = fresh.id
            hub.free_capacity_kg -= shipment.weight_kg
            if windows:
                windows[0].reserved_for = shipment.id
            else:
                hub.dock_slots.remove(slot)
            incident.actions["assignment"] = {
                "truck_id": fresh.id,
                "shipment_id": shipment.id,
                "dock_time": slot.isoformat(),
                "simulated": True,
            }
            incident.status = "executing"
            rows = db.execute(
                "SELECT id,payload FROM records WHERE kind='assignment' "
                "AND json_extract(payload,'$.shipment_id')=? "
                "AND json_extract(payload,'$.status')='active'",
                (shipment.id,),
            ).fetchall()
            for row in rows:
                assignment = json.loads(row["payload"])
                assignment["status"], assignment["ends_at"] = "ended", self.now().isoformat()
                self.store.put("assignment", row["id"], assignment, db)
            assignment_id = f"rescue-{incident.id}"
            self.store.put(
                "assignment",
                assignment_id,
                {
                    "id": assignment_id,
                    "status": "active",
                    "shipment_id": shipment.id,
                    "truck_id": fresh.id,
                    "driver_id": fresh.driver_id,
                    "assigned_mass_kg": shipment.weight_kg,
                    "simulated": True,
                },
                db,
            )
            for kind, record in (
                ("truck", source),
                ("truck", fresh),
                ("shipment", shipment),
                ("warehouse", hub),
                ("incident", incident),
            ):
                self.store.put(kind, record.id, record.model_dump(mode="json"), db)
        self.store.emit(incident.id, "action.completed", incident.actions["assignment"])

    def feedback(self, incident_id, feedback: Feedback):
        self.incident(incident_id)
        result = {
            "id": uuid4().hex,
            "incident_id": incident_id,
            **feedback.model_dump(),
            "at": datetime.now(UTC).isoformat(),
        }
        self.store.put("feedback", result["id"], result)
        if feedback.prefer_cheaper_when_slack:
            if self._dataset == "collected":
                policy = self.store.get("policy", "feedback")
                constraints = policy["if"]
                self.store.put(
                    "preference",
                    "cost_delay_budget",
                    {
                        "rule": "cost_delay_budget",
                        "scope": policy["scope"],
                        "min_savings": constraints["savings_vs_fastest_eligible_inr_at_least"],
                        "max_delay": constraints["delivery_delay_vs_fastest_eligible_min_at_most"],
                        "expires_at": policy["valid_until"],
                        "feedback_id": result["id"],
                        "source_incident": incident_id,
                    },
                )
                self.store.emit(incident_id, "feedback.saved", result)
                return result
            self.store.put(
                "preference",
                "cheapest_when_slack",
                {
                    "rule": "cheapest_when_slack",
                    "min_slack_minutes": 60,
                    "feedback_id": result["id"],
                    "source_incident": incident_id,
                },
            )
        self.store.emit(incident_id, "feedback.saved", result)
        return result

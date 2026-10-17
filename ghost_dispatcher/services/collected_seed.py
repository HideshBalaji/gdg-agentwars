"""Explicit adapter for the data owner's version-1 replay pack; never edits source data."""

import csv
import json
from datetime import UTC, datetime
from pathlib import Path

from ghost_dispatcher.models.contracts import Seed


def collected_seed(settings):
    directory = Path(settings.data_dir)

    def table(name):
        value = json.loads((directory / "seed" / f"{name}.json").read_text())
        if value["schema_version"] != "1.0":
            raise ValueError("Unsupported collected dataset schema")
        return value

    source_clock = datetime.fromisoformat(table("trucks")["provenance"]["replay_at"])
    clock = source_clock if settings.mode == "offline" else datetime.now(UTC)
    shift = clock - source_clock

    def timestamp(value):
        return (datetime.fromisoformat(value) + shift).isoformat()

    readings = []
    with (directory / "sensors" / "gradual_rise.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            if (
                row["quality"] == "valid"
                and row["temp_c"]
                and datetime.fromisoformat(row["observed_at"]) <= source_clock
            ):
                readings.append(
                    {"at": timestamp(row["observed_at"]), "temp_c": float(row["temp_c"])}
                )
    assignments = table("assignments")["records"]
    assigned = {a["shipment_id"]: a for a in assignments if a["status"] == "active"}
    warehouses, slot_hubs = [], {}
    for row in table("warehouses")["records"]:
        windows = []
        for slot in row["dock_slots"]:
            slot_hubs[slot["dock_slot_id"]] = row["hub_id"]
            windows.append(
                {
                    "id": slot["dock_slot_id"],
                    "start": timestamp(slot["starts_at"]),
                    "end": timestamp(slot["ends_at"]),
                    "reserved_for": slot.get("shipment_id"),
                }
            )
        warehouses.append(
            {
                "id": row["hub_id"],
                "location": row["location"],
                "free_capacity_kg": row["remaining_cold_capacity_kg"],
                "dock_slots": [],
                "dock_windows": windows,
            }
        )
    shipments = []
    for row in table("shipments")["records"]:
        bounds = row["temperature_range_c"]
        shipments.append(
            {
                "id": row["shipment_id"],
                "truck_id": assigned[row["shipment_id"]]["truck_id"],
                "cargo": row["description"],
                "weight_kg": row["mass_kg"],
                "temp_min_c": bounds["min"] if bounds else None,
                "temp_max_c": bounds["max"] if bounds else None,
                "safe_minutes_out_of_range": row["safe_minutes_out_of_range"],
                "destination": {
                    **row["destination"]["location"],
                    "label": row["destination"]["name"],
                },
                "warehouse_id": slot_hubs[row["destination"]["dock_slot_id"]],
                "deadline": timestamp(row["delivery_deadline"]),
                "cold_restore_deadline": timestamp(row["cold_control_deadline"])
                if row["cold_control_deadline"]
                else None,
                "transfer_minutes": 15,
                "receiving_minutes": 10,
                "customer_id": row["customer_id"],
                "cargo_profile_id": row["cargo_profile_id"],
            }
        )
    trucks = []
    for row in table("trucks")["records"]:
        if row["availability"] == "broken_down":
            status = "broken"
        elif (
            row["rescue_detour_allowed"] and row["availability"] == "available_for_additional_load"
        ):
            status = "available"
        else:
            status = "unavailable"
        trucks.append(
            {
                "id": row["truck_id"],
                "carrier_id": row["carrier_id"],
                "driver_id": row["driver_id"],
                "reefer": row["reefer"]["installed"] and row["reefer"]["operational"],
                "capacity_kg": row["capacity_kg"],
                "available_capacity_kg": row["remaining_capacity_kg"],
                "location": row["location"],
                "status": status,
                "driver_hours_left": row["driver_remaining_duty_hours"],
                "pricing": row["pricing"],
                "temperature_history": readings if row["truck_id"] == "TN-07" else [],
            }
        )
    carriers = [
        {
            "id": row["carrier_id"],
            "name": row["name"],
            "reliability": row["simulated_reliability_score"],
            "region": row["service_region"],
        }
        for row in table("carriers")["records"]
    ]
    seed = Seed.model_validate(
        {"trucks": trucks, "shipments": shipments, "carriers": carriers, "warehouses": warehouses}
    )
    metadata = {
        "dataset": "collected",
        "clock": clock.isoformat(),
        "mode": settings.mode,
        "replay_source": source_clock.isoformat(),
    }
    policy = json.loads((directory / "feedback" / "preference_rules.json").read_text())["rules"][0]
    policy["valid_until"] = timestamp(policy["valid_until"])
    return seed, metadata, table("rescue_options")["records"], assignments, policy

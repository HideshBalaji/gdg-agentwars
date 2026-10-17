"""Check consumer-visible consistency of the offline logistics fixtures."""

import csv
import json
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from statistics import linear_regression

import pytest

DATA = Path(__file__).resolve().parents[1] / "data"


def load(relative_path):
    return json.loads((DATA / relative_path).read_text())


def records(table):
    return load(f"seed/{table}.json")["records"]


def test_active_assignments_conserve_capacity_and_cargo_requirements():
    trucks = {row["truck_id"]: row for row in records("trucks")}
    shipments = {row["shipment_id"]: row for row in records("shipments")}
    drivers = {row["driver_id"]: row for row in records("drivers")}
    profiles = {row["cargo_profile_id"]: row for row in records("cargo_profiles")}
    active_shipments = Counter()
    truck_mass = Counter()

    for assignment in records("assignments"):
        if assignment["status"] != "active":
            continue
        shipment = shipments[assignment["shipment_id"]]
        truck = trucks[assignment["truck_id"]]
        driver = drivers[assignment["driver_id"]]
        assert driver["truck_id"] == truck["truck_id"]
        assert truck["driver_id"] == driver["driver_id"]
        assert assignment["assigned_mass_kg"] == shipment["mass_kg"]
        if profiles[shipment["cargo_profile_id"]]["requires_reefer"]:
            assert truck["reefer"]["installed"]
        active_shipments[shipment["shipment_id"]] += 1
        truck_mass[truck["truck_id"]] += assignment["assigned_mass_kg"]

    assert set(active_shipments) == set(shipments)
    assert all(count == 1 for count in active_shipments.values())
    for truck in trucks.values():
        assert truck["assigned_mass_kg"] == truck_mass[truck["truck_id"]]
        assert truck["remaining_capacity_kg"] >= 0
        assert truck["capacity_kg"] == (
            truck["assigned_mass_kg"] + truck["remaining_capacity_kg"]
        )


@pytest.mark.parametrize("option", records("rescue_options"), ids=lambda row: row["option_id"])
def test_rescue_options_match_physical_constraints_and_prices(option):
    trucks = {row["truck_id"]: row for row in records("trucks")}
    shipments = {row["shipment_id"]: row for row in records("shipments")}
    truck = trucks[option["truck_id"]]
    shipment = shipments[option["shipment_id"]]
    replay = datetime.fromisoformat(load("scenarios/breakdown.json")["provenance"]["replay_at"])
    restored = replay + timedelta(minutes=option["pickup_eta_min"] + option["transfer_min"])
    delivered = restored + timedelta(
        minutes=option["loaded_drive_min"] + option["destination_handling_min"]
    )
    assert restored == datetime.fromisoformat(option["cold_control_restored_at"])
    assert delivered == datetime.fromisoformat(option["delivery_complete_at"])
    pricing = truck["pricing"]
    assert option["cost"]["amount"] == max(
        pricing["minimum"], pricing["base"] + pricing["per_km"] * option["rescue_route_km"]
    )
    duty_hours = (delivered - replay).total_seconds() / 3600
    assert option["required_duty_hours"] == pytest.approx(duty_hours, abs=1e-6)

    if not truck["reefer"]["installed"] or not truck["reefer"]["operational"]:
        expected = "reject_no_reefer"
    elif truck["remaining_capacity_kg"] < shipment["mass_kg"]:
        expected = "reject_capacity"
    elif truck["driver_remaining_duty_hours"] < duty_hours:
        expected = "reject_hours"
    elif restored > datetime.fromisoformat(shipment["cold_control_deadline"]):
        expected = "reject_cold_deadline"
    elif delivered > datetime.fromisoformat(shipment["delivery_deadline"]):
        expected = "reject_delivery_deadline"
    else:
        supported = truck["reefer"]["supported_range_c"]
        required = shipment["temperature_range_c"]
        assert supported["min"] <= required["min"] <= required["max"] <= supported["max"]
        expected = "eligible"
    assert option["physical_validation_expected"] == expected


def test_baseline_thermal_deadline_is_supported_by_observed_trace():
    fixture = load("scenarios/breakdown.json")
    replay = datetime.fromisoformat(fixture["provenance"]["replay_at"])
    trace_path = DATA.parent / fixture["incident"]["sensor_trace"]
    with trace_path.open(newline="") as stream:
        readings = [
            row
            for row in csv.DictReader(stream)
            if row["quality"] == "valid" and datetime.fromisoformat(row["observed_at"]) <= replay
        ]
    minutes = [
        (datetime.fromisoformat(row["observed_at"]) - replay).total_seconds() / 60
        for row in readings
    ]
    slope, current_temp = linear_regression(minutes, [float(row["temp_c"]) for row in readings])
    assert slope > 0
    shipment = next(
        row for row in records("shipments") if row["shipment_id"] == fixture["incident"]["shipment_id"]
    )
    until_boundary = (shipment["temperature_range_c"]["max"] - current_temp) / slope
    projected = replay + timedelta(minutes=until_boundary)
    assert projected == datetime.fromisoformat(fixture["incident"]["cold_control_deadline"])
    assert projected == datetime.fromisoformat(shipment["cold_control_deadline"])

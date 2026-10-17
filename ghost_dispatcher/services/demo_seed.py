"""Minimal synthetic boot fixture. The data owner's GHOST_SEED_FILE replaces this."""

from datetime import UTC, datetime, timedelta

from ghost_dispatcher.models.contracts import Seed


def demo_seed(now=None):
    now = now or datetime.now(UTC)
    location = {"lat": 12.74, "lng": 77.82, "label": "Hosur demo"}
    readings = [
        {"at": (now - timedelta(minutes=10 - i * 5)).isoformat(), "temp_c": 5 + i * 0.5}
        for i in range(3)
    ]
    return Seed.model_validate(
        {
            "trucks": [
                {
                    "id": "TN-07",
                    "carrier_id": "primary",
                    "reefer": True,
                    "capacity_kg": 2000,
                    "available_capacity_kg": 1000,
                    "location": location,
                    "status": "broken",
                    "driver_hours_left": 5,
                    "temperature_history": readings,
                },
                {
                    "id": "TN-08",
                    "carrier_id": "primary",
                    "reefer": True,
                    "capacity_kg": 1500,
                    "available_capacity_kg": 1500,
                    "location": {**location, "lat": 12.75},
                    "driver_hours_left": 5,
                    "temperature_history": [],
                },
                {
                    "id": "TN-09",
                    "carrier_id": "backup",
                    "reefer": True,
                    "capacity_kg": 1500,
                    "available_capacity_kg": 1500,
                    "location": {**location, "lat": 12.8},
                    "driver_hours_left": 5,
                    "temperature_history": [],
                },
                {
                    "id": "TN-10",
                    "carrier_id": "primary",
                    "reefer": True,
                    "capacity_kg": 1500,
                    "available_capacity_kg": 1500,
                    "location": {**location, "lat": 12.76},
                    "driver_hours_left": 5,
                    "temperature_history": [],
                },
                {
                    "id": "TN-11",
                    "carrier_id": "backup",
                    "reefer": True,
                    "capacity_kg": 1500,
                    "available_capacity_kg": 1500,
                    "location": {**location, "lat": 12.81},
                    "driver_hours_left": 5,
                    "temperature_history": [],
                },
            ],
            "shipments": [
                {
                    "id": f"SHIP-{i}",
                    "truck_id": "TN-07",
                    "cargo": "Synthetic vaccine cargo",
                    "weight_kg": 200,
                    "receiving_minutes": 10,
                    "temp_min_c": 2,
                    "temp_max_c": 8,
                    "safe_minutes_out_of_range": 240,
                    "destination": {"lat": 12.97, "lng": 77.59, "label": "Demo hospital"},
                    "warehouse_id": "HUB-1",
                    "deadline": (now + timedelta(hours=5)).isoformat(),
                }
                for i in (1, 2)
            ],
            "carriers": [
                {
                    "id": "primary",
                    "name": "Fast Reefer (simulated)",
                    "cost_per_km": 12,
                    "reliability": 0.99,
                },
                {
                    "id": "backup",
                    "name": "Budget Reefer (simulated)",
                    "cost_per_km": 6,
                    "reliability": 0.95,
                },
                {
                    "id": "third",
                    "name": "Third Carrier (simulated)",
                    "cost_per_km": 9,
                    "reliability": 0.97,
                },
            ],
            "warehouses": [
                {
                    "id": "HUB-1",
                    "location": {"lat": 12.97, "lng": 77.59},
                    "free_capacity_kg": 5000,
                    "dock_slots": [
                        (now + timedelta(minutes=i)).isoformat() for i in (90, 120, 180, 240)
                    ],
                }
            ],
        }
    )


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Export fresh synthetic seed data")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    Path(args.output).write_text(demo_seed().model_dump_json(indent=2) + "\n")
    print(f"Synthetic seed written to {args.output}")

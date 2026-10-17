"""Deterministic demo constraints. These are not medical or legal certifications."""

import math
from datetime import timedelta

from ghost_dispatcher.models.contracts import Candidate, Shipment, Truck
from ghost_dispatcher.services.store import DomainError


def distance_km(a, b):
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat, dlon = lat2 - lat1, math.radians(b.lng - a.lng)
    hav = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(hav)))


def rescue_deadline(shipment: Shipment, truck: Truck, now):
    if shipment.temp_min_c is None or shipment.temp_max_c is None:
        raise DomainError("policy_missing", "This shipment has no supplied cold-chain policy")
    readings = sorted(truck.temperature_history, key=lambda r: r.at)
    if len(readings) < 3:
        raise DomainError("sensor_data_missing", "At least three timestamped readings are required")
    latest = readings[-1]
    if (now - latest.at).total_seconds() > 15 * 60 or latest.at > now:
        raise DomainError("sensor_data_stale", "Latest reading must be within the last 15 minutes")
    if any(r.temp_c < shipment.temp_min_c for r in readings):
        raise DomainError(
            "lower_temperature_excursion", "Below-range data requires operator review"
        )
    if len({r.at for r in readings}) != len(readings):
        raise DomainError("sensor_data_invalid", "Duplicate sensor timestamps")
    times = [(r.at - readings[0].at).total_seconds() / 60 for r in readings]
    mean_x = sum(times) / len(times)
    mean_y = sum(r.temp_c for r in readings) / len(readings)
    slope = sum((x - mean_x) * (r.temp_c - mean_y) for x, r in zip(times, readings)) / sum(
        (x - mean_x) ** 2 for x in times
    )
    # Conservative synthetic window: already-observed excursions consume allowance.
    above = [r.at for r in readings if r.temp_c > shipment.temp_max_c]
    if above:
        crossing = above[0]
        previous = [r for r in readings if r.at < crossing and r.temp_c <= shipment.temp_max_c]
        if previous:
            left, right = previous[-1], next(r for r in readings if r.at == crossing)
            fraction = (shipment.temp_max_c - left.temp_c) / (right.temp_c - left.temp_c)
            crossing = left.at + (right.at - left.at) * fraction
        else:
            raise DomainError(
                "excursion_start_unknown", "Readings do not establish excursion start"
            )
    elif slope > 0:
        crossing = latest.at + timedelta(
            minutes=max(0, (shipment.temp_max_c - latest.temp_c) / slope)
        )
    else:
        # Flat/falling readings do not establish an unlimited safety window.
        crossing = now
    if shipment.cold_restore_deadline is not None:
        # Collected baseline explicitly does NOT extend the cold deadline by its
        # fictional excursion allowance. Restoration and delivery are separate.
        return min(shipment.cold_restore_deadline, crossing)
    if shipment.safe_minutes_out_of_range is None:
        raise DomainError("policy_missing", "No excursion allowance was supplied")
    return min(shipment.deadline, crossing + timedelta(minutes=shipment.safe_minutes_out_of_range))


def violations(shipment: Shipment, truck: Truck, candidate: Candidate, deadline, now):
    errors = []
    if not truck.reefer:
        errors.append("Replacement truck requires a reefer")
    if truck.status != "available":
        errors.append("Replacement truck is not available")
    if truck.available_capacity_kg < shipment.weight_kg:
        errors.append("Insufficient available capacity")
    if shipment.cold_restore_deadline is not None:
        if candidate.cold_restore_at is None or candidate.cold_restore_at > deadline:
            errors.append("Refrigeration is restored after the cold-control deadline")
        receiving_deadline = shipment.deadline
    else:
        receiving_deadline = deadline
    if candidate.arrival > receiving_deadline or candidate.dock_time > receiving_deadline:
        errors.append("Receiving occurs after the demo rescue deadline")
    if candidate.dock_time > candidate.arrival or candidate.arrival <= now:
        errors.append("Invalid arrival or receiving time")
    duty = (
        candidate.duty_minutes if candidate.duty_minutes is not None else candidate.travel_minutes
    )
    if duty / 60 > truck.driver_hours_left:
        errors.append("Insufficient supplied driver hours")
    return errors

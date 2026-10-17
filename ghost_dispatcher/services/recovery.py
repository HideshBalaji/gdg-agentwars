"""Bounded retry and persisted expiring carrier circuit breakers."""

import asyncio
from datetime import UTC, datetime, timedelta

import httpx

from ghost_dispatcher.services.store import DomainError


class CarrierUnavailable(DomainError):
    def __init__(self, message="Carrier temporarily unavailable"):
        super().__init__("carrier_unavailable", message, 503)


class Recovery:
    def __init__(self, store, delay=0.05):
        self.store, self.delay = store, delay

    def available(self, carrier_id):
        return self.availability().get(carrier_id, True)

    def availability(self):
        now = datetime.now(UTC)
        return {
            record["id"]: datetime.fromisoformat(record["retry_at"]) <= now
            for record in self.store.list("circuit")
        }

    async def run(self, incident_id, carrier_id, operation):
        if not self.available(carrier_id):
            self.store.emit(
                incident_id,
                "healing",
                {"provider": carrier_id, "level": "circuit", "status": "skipped_until_probe"},
            )
            raise CarrierUnavailable("Carrier circuit is open")
        for attempt in range(1, 4):
            try:
                result = await operation()
                self.store.put(
                    "circuit",
                    carrier_id,
                    {"id": carrier_id, "retry_at": datetime.now(UTC).isoformat()},
                )
                self.store.emit(
                    incident_id,
                    "healing",
                    {
                        "provider": carrier_id,
                        "level": "retry",
                        "attempt": attempt,
                        "status": "recovered",
                    },
                )
                return result
            except (CarrierUnavailable, httpx.ConnectError, httpx.ConnectTimeout):
                # A connection failure occurs before a booking response. Uncertain read timeouts
                # are deliberately NOT retried or sent to a backup without reconciliation.
                self.store.emit(
                    incident_id,
                    "healing",
                    {
                        "provider": carrier_id,
                        "level": "retry",
                        "attempt": attempt,
                        "status": "failed",
                    },
                )
                if attempt < 3:
                    await asyncio.sleep(self.delay * 2 ** (attempt - 1))
        self.store.put(
            "circuit",
            carrier_id,
            {"id": carrier_id, "retry_at": (datetime.now(UTC) + timedelta(seconds=60)).isoformat()},
        )
        raise CarrierUnavailable()

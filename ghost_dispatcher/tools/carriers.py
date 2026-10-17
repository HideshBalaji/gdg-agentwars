import httpx

from ghost_dispatcher.services.recovery import CarrierUnavailable
from ghost_dispatcher.services.store import DomainError


class CarrierGateway:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store

    async def book(self, carrier_id, request_id, shipment_id, truck_id):
        payload = {
            "id": request_id,
            "carrier_id": carrier_id,
            "shipment_id": shipment_id,
            "truck_id": truck_id,
        }
        if self.settings.mode == "offline":
            return self.mock_book(payload)
        if not self.settings.carrier_url:
            raise DomainError(
                "not_configured", "Set GHOST_CARRIER_URL to the mock carrier API", 503
            )
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                response = await client.put(
                    f"{self.settings.carrier_url}/bookings/{request_id}", json=payload
                )
            except (httpx.ReadTimeout, httpx.WriteTimeout):
                response = await client.get(f"{self.settings.carrier_url}/bookings/{request_id}")
                if response.status_code == 404:
                    raise DomainError("booking_uncertain", "Reconcile booking before retrying", 503)
            if response.status_code == 503:
                # Mock contract: 503 guarantees no booking was committed.
                raise CarrierUnavailable()
            response.raise_for_status()
            return response.json()

    def mock_book(self, payload):
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                existing = self.store.get("booking", payload["id"], db)
            except DomainError:
                existing = None
            if existing:
                if any(existing[k] != v for k, v in payload.items()):
                    raise DomainError("idempotency_conflict", "Booking key already used")
                return existing
            self.store.get("carrier", payload["carrier_id"], db)
            try:
                health = self.store.get("health", payload["carrier_id"], db)
            except DomainError:
                health = {"alive": True}
            if not health["alive"]:
                raise CarrierUnavailable()
            result = {**payload, "status": "confirmed", "simulated": True}
            self.store.put("booking", payload["id"], result, db)
            return result

    def health(self, carrier_id, alive):
        self.store.get("carrier", carrier_id)
        self.store.put("health", carrier_id, {"id": carrier_id, "alive": alive})
        if alive:
            self.store.put(
                "circuit", carrier_id, {"id": carrier_id, "retry_at": "2000-01-01T00:00:00+00:00"}
            )
        return {"carrier_id": carrier_id, "alive": alive, "simulated": True}

"""Authenticated MCP transport; shares typed operations with the HTTP API."""

import hmac

import httpx
from mcp.server.fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ghost_dispatcher.config import Settings
from ghost_dispatcher.services.dispatcher import DispatcherService
from ghost_dispatcher.services.store import DomainError


def build_mcp(service):
    mcp = FastMCP("logistics-mcp", stateless_http=True, json_response=True)

    async def write(path, payload=None):
        # Mutations go to the API worker so HTTP and MCP share incident locks.
        async with httpx.AsyncClient(
            timeout=60, headers={"Authorization": f"Bearer {service.settings.token}"}
        ) as client:
            response = await client.post(f"{service.settings.api_url}{path}", json=payload)
            response.raise_for_status()
            return response.json()

    @mcp.tool()
    def get_shipment(shipment_id: str) -> dict:
        """Retrieve current cargo, temperature constraints, deadline and assigned truck."""
        return service.store.get("shipment", shipment_id)

    @mcp.tool()
    def list_trucks_near(
        lat: float, lng: float, radius_km: float = 100, needs_reefer: bool = True
    ) -> list[dict]:
        """Find available trucks within a bounded radius (kilometres)."""
        if not 0 < radius_km <= 500:
            raise ValueError("radius_km must be between 0 and 500")
        return service.trucks_near(lat, lng, radius_km, needs_reefer)

    @mcp.tool()
    def get_temperature_history(truck_id: str) -> list[dict]:
        """Read timestamped temperature evidence; do not infer medical safety."""
        return service.store.get("truck", truck_id)["temperature_history"]

    @mcp.tool()
    def find_cold_hubs_near(lat: float, lng: float) -> list[dict]:
        """Return demo receiving hubs with available capacity."""
        from ghost_dispatcher.models.contracts import Location
        from ghost_dispatcher.services.validation import distance_km

        location = Location(lat=lat, lng=lng)
        return [
            row
            for row in service.store.list("warehouse")
            if row["free_capacity_kg"] > 0
            and distance_km(location, Location.model_validate(row["location"])) <= 500
        ]

    @mcp.tool()
    def list_carriers(region: str | None = None) -> list[dict]:
        """List configured carriers and their expiring circuit-breaker status."""
        availability = service.recovery.availability()
        return [
            {**row, "circuit_available": availability.get(row["id"], True)}
            for row in service.store.list("carrier")
            if region is None or row["region"] == region
        ]

    @mcp.tool()
    async def assign_load(incident_id: str, truck_id: str) -> dict:
        """Execute an incident's validated plan; no arbitrary stock or vehicle changes."""
        incident = service.incident(incident_id)
        if not incident.plan or incident.plan.chosen.truck_id != truck_id:
            raise DomainError("plan_mismatch", "Create a matching validated plan first")
        return await write(f"/api/incidents/{incident_id}/execute")

    @mcp.tool()
    def book_dock_slot(incident_id: str) -> dict:
        """Read the dock reservation receipt. Reservation is atomic with load assignment."""
        incident = service.incident(incident_id)
        if "assignment" not in incident.actions:
            raise DomainError("assignment_required", "Execute the validated assignment first")
        return incident.actions["assignment"]

    @mcp.tool()
    async def log_incident(shipment_id: str, description: str) -> dict:
        """Create a breakdown incident. Existing action history cannot be overwritten."""
        return await write(
            "/api/incidents",
            {"shipment_id": shipment_id, "type": "truck_breakdown", "description": description},
        )

    return mcp


def create_app(settings=None):
    settings = settings or Settings.from_env()
    service = DispatcherService(settings)
    service.bootstrap()
    app = build_mcp(service).streamable_http_app()

    class Auth(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            actual = request.headers.get("authorization", "")
            if not hmac.compare_digest(actual, f"Bearer {settings.token}"):
                return JSONResponse({"code": "unauthorized"}, status_code=401)
            return await call_next(request)

    app.add_middleware(Auth)
    return app


def main():
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8001)

"""Stage-only carrier mock. A 503 explicitly means no booking was committed."""

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ghost_dispatcher.config import Settings
from ghost_dispatcher.services.dispatcher import DispatcherService
from ghost_dispatcher.services.store import DomainError


class Booking(BaseModel):
    id: str
    carrier_id: str
    shipment_id: str
    truck_id: str


def create_app(service=None):
    service = service or DispatcherService(Settings.from_env())
    service.bootstrap()
    app = FastAPI(title="Ghost Dispatcher simulated carrier")

    @app.exception_handler(DomainError)
    async def error(request, exc):
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)

    @app.put("/bookings/{request_id}")
    def book(request_id: str, request: Booking):
        if request_id != request.id:
            raise DomainError("invalid_argument", "Booking ID mismatch", 422)
        return service.carriers.mock_book(request.model_dump())

    @app.get("/bookings/{request_id}")
    def status(request_id: str):
        return service.store.get("booking", request_id)

    @app.post("/kill")
    def kill(carrier_id: str = "primary"):
        return service.carriers.health(carrier_id, False)

    @app.post("/revive")
    def revive(carrier_id: str = "primary"):
        return service.carriers.health(carrier_id, True)

    return app

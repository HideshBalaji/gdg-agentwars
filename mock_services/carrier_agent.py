"""The carrier company's own booking agent: a separate ADK agent served over A2A.

Ghost Dispatcher never writes a carrier booking itself. Its negotiator and its booking gateway
send A2A (JSON-RPC) messages to this agent, which owns quotes, confirmations and status, the
way an independent carrier would. Run standalone with `make carrier-agent`; the agent card is
published at /.well-known/agent-card.json."""

import json
import re
from collections.abc import AsyncGenerator

from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.agents import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from ghost_dispatcher.services.store import DomainError

NAME = "carrier_desk"
DESCRIPTION = (
    "Independent refrigerated carrier booking desk (simulated). Quotes rescue trucks, "
    "confirms idempotent bookings and reports booking status."
)
RULES = """You are the booking desk of an independent refrigerated carrier (simulated cargo).
You answer other companies' agents over A2A. Use your tools for every quote, booking and status;
never invent prices, trucks, ETAs or confirmations. A booking request carries request_id,
carrier_id, shipment_id and truck_id: call confirm_booking with exactly those values. If a request
lacks them, ask for them. Reply with the tool result as JSON. Never share personal information
about drivers or customers; refer to them by ID only."""


class CarrierDeskModel(BaseLlm):
    """Deterministic offline stand-in for Gemini on the carrier side. It reads the A2A request
    and calls the carrier's real tools; it never claims Gemini ran."""

    model: str = "carrier-desk-offline-simulation"

    async def generate_content_async(self, llm_request, stream=False) -> AsyncGenerator:
        contents = llm_request.contents
        results = [p.function_response for p in contents[-1].parts or [] if p.function_response]
        if results:
            text = f"[SIMULATED / {NAME}] " + json.dumps(results[-1].response, default=str)
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))
            return
        request = " ".join(
            p.text for c in contents if c.role == "user" for p in c.parts or [] if p.text
        )
        payload = {}
        if match := re.search(r"\{.*\}", request, re.DOTALL):
            try:
                payload = json.loads(match.group())
            except json.JSONDecodeError:
                payload = {}
        action = payload.get("action") or (
            "book"
            if re.search(r"\b(book|confirm)\b", request, re.IGNORECASE)
            else "status"
            if re.search(r"\bstatus\b", request, re.IGNORECASE)
            else "quote"
        )
        fields = {
            "book": ("request_id", "carrier_id", "shipment_id", "truck_id"),
            "quote": ("shipment_id", "truck_id"),
            "status": ("request_id",),
        }[action]
        if not all(payload.get(key) for key in fields):
            text = f"[SIMULATED / {NAME}] Please send {', '.join(fields)} as JSON."
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))
            return
        tool = {"book": "confirm_booking", "quote": "quote_rescue", "status": "booking_status"}
        call = types.FunctionCall(
            name=tool[action], args={key: str(payload[key]) for key in fields}
        )
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(function_call=call)])
        )


def build_carrier_agent(service):
    def quote_rescue(shipment_id: str, truck_id: str) -> dict:
        """Quote a refrigerated rescue of one shipment by one of the carrier's trucks."""
        truck = service.store.get("truck", truck_id)
        quotes = [
            q
            for q in service.store.list("route_quote")
            if q["truck_id"] == truck_id and q["shipment_id"] == shipment_id
        ]
        available = truck["status"] == "available" and truck["reefer"]
        if quotes:
            quote = quotes[0]
            return {
                "shipment_id": shipment_id,
                "truck_id": truck_id,
                "carrier_id": truck["carrier_id"],
                "available": available,
                "price": quote["cost"]["amount"],
                "currency": quote["cost"]["currency"],
                "pickup_eta_min": quote["pickup_eta_min"],
                "loaded_drive_min": quote["loaded_drive_min"],
                "simulated": True,
            }
        for incident in service.store.list("incident"):
            plan = incident.get("plan") or {}
            for candidate in plan.get("candidates", []):
                if candidate["truck_id"] == truck_id and incident["shipment_id"] == shipment_id:
                    return {
                        "shipment_id": shipment_id,
                        "truck_id": truck_id,
                        "carrier_id": truck["carrier_id"],
                        "available": available,
                        "price": candidate["cost"],
                        "currency": candidate["currency"],
                        "travel_minutes": candidate["travel_minutes"],
                        "simulated": True,
                    }
        return {"truck_id": truck_id, "available": available, "price": None, "simulated": True}

    def confirm_booking(request_id: str, carrier_id: str, shipment_id: str, truck_id: str) -> dict:
        """Confirm a rescue booking. Idempotent: the same request_id returns the same booking."""
        try:
            return service.carriers.mock_book(
                {
                    "id": request_id,
                    "carrier_id": carrier_id,
                    "shipment_id": shipment_id,
                    "truck_id": truck_id,
                }
            )
        except DomainError as error:
            return {
                "id": request_id,
                "status": "unavailable" if error.code == "carrier_unavailable" else "rejected",
                "error": {"code": error.code, "message": error.message, "status": error.status},
                "simulated": True,
            }

    def booking_status(request_id: str) -> dict:
        """Report the carrier's record of a booking request."""
        try:
            return service.store.get("booking", request_id)
        except DomainError:
            return {"id": request_id, "status": "not_found", "simulated": True}

    guard = service.guardrails
    settings = service.settings
    return LlmAgent(
        name=NAME,
        model=CarrierDeskModel() if settings.mode == "offline" else settings.flash_model,
        description=DESCRIPTION,
        instruction=RULES,
        tools=[quote_rescue, confirm_booking, booking_status],
        before_model_callback=guard.before_model,
        after_model_callback=guard.after_model,
        before_tool_callback=guard.before_tool,
        after_tool_callback=guard.after_tool,
    )


def create_app(service=None, host="127.0.0.1", port=8003):
    if service is None:
        from ghost_dispatcher.config import Settings
        from ghost_dispatcher.services.dispatcher import DispatcherService

        service = DispatcherService(Settings.from_env())
        service.bootstrap()
    return to_a2a(build_carrier_agent(service), host=host, port=port)


def main():
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8003)

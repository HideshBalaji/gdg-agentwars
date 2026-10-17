"""A2A client for the carrier's booking agent (agent card + JSON-RPC message/send).

With GHOST_CARRIER_AGENT_URL set, it talks to a separately running carrier agent over HTTP.
Without it (offline default), the same A2A protocol runs over an in-process ASGI transport, so
tests and evaluators need no extra server."""

import json
from contextlib import asynccontextmanager

import httpx
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.helpers import new_data_part, new_text_message
from a2a.types import Role, SendMessageRequest
from google.protobuf.json_format import MessageToDict

from ghost_dispatcher.services.recovery import CarrierUnavailable
from ghost_dispatcher.services.store import DomainError

IN_PROCESS_URL = "http://carrier-desk.local"
CARRIER_AGENT = "carrier_desk"


class CarrierAgentClient:
    def __init__(self, service):
        self.service = service
        self.settings, self.store = service.settings, service.store

    @asynccontextmanager
    async def _client(self):
        url = self.settings.carrier_agent_url
        if url:
            async with httpx.AsyncClient(timeout=60) as http:
                card = await A2ACardResolver(http, url).get_agent_card()
                yield ClientFactory(ClientConfig(httpx_client=http, streaming=False)).create(card)
            return
        from mock_services.carrier_agent import create_app

        app = create_app(self.service, host="carrier-desk.local", port=80)
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url=IN_PROCESS_URL, timeout=60
            ) as http:
                card = await A2ACardResolver(http, IN_PROCESS_URL).get_agent_card()
                yield ClientFactory(ClientConfig(httpx_client=http, streaming=False)).create(card)

    def _emit(self, incident_id, data):
        if incident_id:
            self.store.emit(incident_id, "a2a", data)

    async def send(self, text, *, data=None, incident_id=None, sender="negotiator"):
        """Send one A2A message and return the carrier agent's reply and tool results."""
        self._emit(
            incident_id,
            {
                "direction": "request",
                "from": sender,
                "to": CARRIER_AGENT,
                "protocol": "A2A JSON-RPC message/send",
                "transport": "http" if self.settings.carrier_agent_url else "in-process",
                "text": text[:500],
            },
        )
        message = new_text_message(text, role=Role.ROLE_USER)
        if data is not None:
            message.parts.append(new_data_part(data))
        result = {}
        async with self._client() as client:
            async for response in client.send_message(SendMessageRequest(message=message)):
                result = MessageToDict(response)
        task = result.get("task") or {}
        reply = "\n".join(
            part["text"]
            for artifact in task.get("artifacts", [])
            for part in artifact.get("parts", [])
            if "text" in part
        )
        tool_results = [
            part["data"]
            for message in task.get("history", [])
            for part in message.get("parts", [])
            if part.get("metadata", {}).get("adk_type") == "function_response"
        ]
        outcome = {
            "state": task.get("status", {}).get("state", "UNKNOWN").removeprefix("TASK_STATE_"),
            "task_id": task.get("id"),
            "reply": reply,
            "tool_results": tool_results,
        }
        self._emit(
            incident_id,
            {
                "direction": "response",
                "from": CARRIER_AGENT,
                "to": sender,
                "state": outcome["state"],
                "task_id": outcome["task_id"],
                "tools": [r.get("name") for r in tool_results],
                "text": reply[:500],
            },
        )
        return outcome

    async def book(self, payload, *, incident_id=None):
        """Ask the carrier agent to confirm a booking; map its answer onto gateway semantics."""
        request = {
            "action": "book",
            "request_id": payload["id"],
            "carrier_id": payload["carrier_id"],
            "shipment_id": payload["shipment_id"],
            "truck_id": payload["truck_id"],
        }
        outcome = await self.send(
            "Confirm this rescue booking: " + json.dumps(request),
            data=request,
            incident_id=incident_id,
        )
        bookings = [
            r["response"] for r in outcome["tool_results"] if r.get("name") == "confirm_booking"
        ]
        if not bookings:
            raise DomainError(
                "carrier_agent_no_confirmation",
                "The carrier agent did not confirm the booking; reconcile before retrying",
                503,
            )
        booking = bookings[-1]
        error = booking.get("error")
        if error:
            if error["code"] == "carrier_unavailable":
                raise CarrierUnavailable(error["message"])
            raise DomainError(error["code"], error["message"], error["status"])
        return booking

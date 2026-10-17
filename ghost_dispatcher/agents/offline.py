"""Deterministic ADK model double: exercises real tools/transfers without claiming Gemini ran."""

import json
import re
from collections.abc import AsyncGenerator

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types


class OfflineModel(BaseLlm):
    role: str
    model: str = "ghost-offline-simulation"

    async def generate_content_async(self, llm_request, stream=False) -> AsyncGenerator:
        contents = llm_request.contents
        # ADK 2.12 quotes other agents' activity as user-role context. Those are
        # transcripts, not a new user command; keep the actual conversation input.
        last_user = max(
            (
                i
                for i, c in enumerate(contents)
                if c.role == "user"
                and any(p.text for p in c.parts or [])
                and not any(
                    "<<<BEGIN_QUOTED_AGENT_CONTENT>>>" in (p.text or "") for p in c.parts or []
                )
            ),
            default=0,
        )
        text = " ".join(p.text for p in contents[last_user].parts or [] if p.text).lower()
        results = [
            p.function_response
            for p in contents[-1].parts or []
            if p.function_response and p.function_response.name != "transfer_to_agent"
        ]
        if results:
            part = types.Part(
                text=f"[SIMULATED / {self.role}] " + json.dumps(results[-1].response, default=str)
            )
        else:
            names = "dispatcher|intake|route_risk|negotiator|comms|validator|watchdog|critic"
            match = re.search(rf"(?:switch to|transfer.*?to|handover to)\s+({names})", text)
            target = match.group(1) if match else None
            if "coordinator" in text and ("switch" in text or "back" in text):
                target = "dispatcher"
            if not target and self.role == "dispatcher":
                if any(w in text for w in ("execute", "book", "assign", "quote", "carrier")):
                    target = "negotiator"
                elif any(w in text for w in ("feedback", "expensive", "cheaper")):
                    target = "critic"
                elif any(w in text for w in ("plan", "rescue", "breakdown")):
                    target = "route_risk"
            if (
                not target
                and self.role in {"intake", "route_risk", "validator"}
                and any(w in text for w in ("quote", "book", "execute"))
            ):
                # Peer handover: bookings and carrier quotes belong to the negotiator.
                target = "negotiator"
            if target and target != self.role:
                part = types.Part(
                    function_call=types.FunctionCall(
                        name="transfer_to_agent", args={"agent_name": target}
                    )
                )
            else:
                tool, args = "get_incident", {}
                if self.role == "planning_step" or (
                    self.role == "route_risk"
                    and any(word in text for word in ("plan", "rescue", "options"))
                ):
                    tool = "plan_rescue"
                elif self.role == "negotiator" and (
                    any(w in text for w in ("quote", "price", "availab"))
                    or ("carrier" in text and "status" in text)
                ):
                    question = (
                        "What is the status of this booking request?"
                        if "status" in text
                        else "Please quote the planned rescue truck for this shipment."
                    )
                    tool, args = "message_carrier_desk", {"message": question}
                elif self.role == "negotiator" and any(
                    w in text for w in ("execute", "book", "assign")
                ):
                    tool = "execute_rescue"
                elif self.role == "critic" and any(w in text for w in ("expensive", "cheaper")):
                    tool, args = (
                        "record_feedback",
                        {
                            "rating": "down",
                            "reason": text[:1000],
                            "prefer_cheaper_when_slack": True,
                        },
                    )
                elif self.role == "validation_step":
                    tool = "validate_and_exit"
                elif self.role == "validator":
                    tool = "validate_current_plan"
                elif self.role in {"watchdog", "comms"} and any(
                    w in text for w in ("retry", "resume", "recover", "sync")
                ):
                    tool = "execute_rescue"
                part = types.Part(function_call=types.FunctionCall(name=tool, args=args))
        yield LlmResponse(content=types.Content(role="model", parts=[part]))

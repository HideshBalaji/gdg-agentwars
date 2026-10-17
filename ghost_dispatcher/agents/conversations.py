import asyncio
from pathlib import Path
from uuid import uuid4

from google.adk.agents.run_config import RunConfig
from google.adk.events import Event
from google.adk.events.event_actions import EventActions
from google.adk.runners import Runner
from google.adk.sessions.sqlite_session_service import SqliteSessionService
from google.genai import types

from ghost_dispatcher.agents.team import build_team
from ghost_dispatcher.monitoring import tool_result
from ghost_dispatcher.services.store import DomainError


class Conversations:
    def __init__(self, service):
        self.service = service
        self.sessions = SqliteSessionService(db_path=f"{service.settings.database}.sessions.sqlite")
        self.runner = Runner(
            app_name="ghost_dispatcher", agent=build_team(service), session_service=self.sessions
        )
        self.locks = {}

    async def create(self, incident_id):
        self.service.incident(incident_id)
        conversation_id = uuid4().hex
        await self.sessions.create_session(
            app_name="ghost_dispatcher",
            user_id="demo",
            session_id=conversation_id,
            state={"incident_id": incident_id, "active_agent": "dispatcher", "handover_count": 0},
        )
        record = {
            "id": conversation_id,
            "incident_id": incident_id,
            "active_agent": "dispatcher",
            "messages": [],
        }
        self.service.store.put("conversation", conversation_id, record)
        return record

    async def send(self, conversation_id, message, observer=None):
        lock = self.locks.setdefault(conversation_id, asyncio.Lock())
        async with lock:
            record = self.service.store.get("conversation", conversation_id)
            message = message.model_copy(
                update={
                    "text": self.service.guardrails.redact_input(
                        message.text, surface="chat", incident_id=record["incident_id"]
                    )
                }
            )
            session = await self.sessions.get_session(
                app_name="ghost_dispatcher", user_id="demo", session_id=conversation_id
            )
            if session is None:
                raise DomainError("session_missing", "Conversation session is unavailable", 409)
            await self.sessions.append_event(
                session,
                Event(
                    author="user",
                    actions=EventActions(state_delta={"handover_count": 0, "tool_failures": {}}),
                ),
            )
            text = message.text
            if message.target_agent:
                text = f"Please switch to {message.target_agent}. {text}"
            parts = [types.Part(text=text)]
            evidence_ids = list(
                dict.fromkeys(
                    self.service.incident(record["incident_id"]).evidence_ids + message.evidence_ids
                )
            )
            evidence_records = [self.service.store.get("evidence", key) for key in evidence_ids]
            if (
                len(evidence_records) > 10
                or sum(e["size"] for e in evidence_records) > 20 * 1024 * 1024
            ):
                raise DomainError(
                    "evidence_limit", "Use at most 10 attachments totaling 20 MiB", 413
                )
            for evidence in evidence_records:
                if self.service.settings.mode == "live":
                    parts.append(
                        types.Part.from_bytes(
                            data=Path(evidence["path"]).read_bytes(),
                            mime_type=evidence["mime_type"],
                        )
                    )
            record["messages"].append({"role": "user", "text": message.text})
            self.service.store.put("conversation", conversation_id, record)
            replies, tool_results = [], []
            async for event in self.runner.run_async(
                user_id="demo",
                session_id=conversation_id,
                new_message=types.Content(role="user", parts=parts),
                run_config=RunConfig(max_llm_calls=24),
            ):
                if observer:
                    observer(event)
                for response in event.get_function_responses():
                    tool_results.append(tool_result(response.name, response.response))
                if event.is_final_response() and event.content:
                    content = "\n".join(p.text for p in event.content.parts or [] if p.text)
                    if content:
                        replies.append({"role": "agent", "agent": event.author, "text": content})
                        self.service.store.emit(record["incident_id"], "message", replies[-1])
                        # Score the reply against this turn's evidence before anyone acts on it.
                        quality = self.service.monitor.evaluate(
                            record["incident_id"], event.author, content, tool_results
                        )
                        replies[-1]["quality"] = {
                            key: quality[key]
                            for key in ("groundedness", "truthfulness", "hallucinated")
                        }
            session = await self.sessions.get_session(
                app_name="ghost_dispatcher", user_id="demo", session_id=conversation_id
            )
            record["active_agent"] = session.state.get("active_agent", "dispatcher")
            record["messages"].extend(replies)
            self.service.store.put("conversation", conversation_id, record)
            return {
                "conversation_id": conversation_id,
                "active_agent": record["active_agent"],
                "replies": replies,
                "simulated": self.service.settings.mode == "offline",
            }

    async def close(self):
        await self.runner.close()

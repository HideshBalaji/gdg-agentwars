import asyncio

from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ghost_dispatcher.agents.conversations import Conversations
from ghost_dispatcher.agents.team import build_team
from ghost_dispatcher.models.contracts import Message


def test_specialist_ownership_survives_runner_restart(service, incident):
    async def scenario():
        first = Conversations(service)
        conversation = await first.create(incident.id)
        await first.send(conversation["id"], Message(text="Plan a rescue"))
        await first.close()
        second = Conversations(service)
        try:
            result = await second.send(conversation["id"], Message(text="Why this vehicle?"))
            assert result["active_agent"] == "route_risk"
            assert result["replies"][-1]["agent"] == "route_risk"
        finally:
            await second.close()

    asyncio.run(scenario())


def test_adk_validation_loop_stops_on_valid_plan(service, incident):
    async def scenario():
        team = build_team(service)
        workflow = team.tools[-1].agent
        sessions = InMemorySessionService()
        session = await sessions.create_session(
            app_name="loop_test", user_id="demo", state={"incident_id": incident.id}
        )
        runner = Runner(app_name="loop_test", agent=workflow, session_service=sessions)
        try:
            async for _ in runner.run_async(
                user_id="demo",
                session_id=session.id,
                new_message=types.Content(role="user", parts=[types.Part(text="Plan a rescue")]),
                run_config=RunConfig(max_llm_calls=12),
            ):
                pass
            assert service.incident(incident.id).plan is not None
            assert sum(e.type == "validation" for e in service.store.events(incident.id)) == 1
        finally:
            await runner.close()

    asyncio.run(scenario())


def test_adk_validation_loop_bounds_failed_attempts(service, incident):
    async def scenario():
        for truck in service.store.list("truck"):
            truck["available_capacity_kg"] = 0
            service.store.put("truck", truck["id"], truck)
        workflow = build_team(service).tools[-1].agent
        sessions = InMemorySessionService()
        session = await sessions.create_session(
            app_name="blocked_test", user_id="demo", state={"incident_id": incident.id}
        )
        runner = Runner(app_name="blocked_test", agent=workflow, session_service=sessions)
        try:
            async for _ in runner.run_async(
                user_id="demo",
                session_id=session.id,
                new_message=types.Content(role="user", parts=[types.Part(text="Plan a rescue")]),
                run_config=RunConfig(max_llm_calls=16),
            ):
                pass
            assert service.incident(incident.id).plan is None
            assert sum(e.type == "validation" for e in service.store.events(incident.id)) == 3
        finally:
            await runner.close()

    asyncio.run(scenario())

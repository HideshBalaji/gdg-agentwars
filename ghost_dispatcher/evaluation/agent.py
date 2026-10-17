"""Agent under test for ADK `AgentEvaluator` (module name must end in `.agent`).

Builds the real Ghost Dispatcher team against an isolated, freshly seeded
database with one planned incident, so every eval case starts from the same
facts. GHOST_EVAL_MODE=live evaluates real Gemini (needs the live .env).
"""

import os
import tempfile
from dataclasses import replace
from pathlib import Path

from ghost_dispatcher.agents.team import build_team
from ghost_dispatcher.config import Settings
from ghost_dispatcher.models.contracts import Incident, IncidentCreate
from ghost_dispatcher.services.dispatcher import DispatcherService

INCIDENT_ID = "eval-incident-001"
ROOT = Path(__file__).resolve().parents[2]
_service: DispatcherService | None = None


async def build_service() -> DispatcherService:
    global _service
    if _service is None:
        directory = tempfile.mkdtemp(prefix="ghost-eval-")
        live = os.getenv("GHOST_EVAL_MODE", "offline") == "live"
        base = Settings.from_env() if live else Settings()
        settings = replace(
            base,
            mode="live" if live else "offline",
            database=f"{directory}/ghost.sqlite",
            dataset="collected",
            data_dir=str(ROOT / "data"),
            seed_file=None,
        )
        service = DispatcherService(settings)
        service.bootstrap()
        created = service.create_incident(
            IncidentCreate(shipment_id="SHP-001", type="truck_breakdown", description="Eval: TN-07 breakdown near Hosur")
        )
        pinned = Incident.model_validate({**created.model_dump(mode="json"), "id": INCIDENT_ID})
        service.save(pinned)
        await service.plan(INCIDENT_ID)
        _service = service
    return _service


async def get_agent_async():
    service = await build_service()
    return build_team(service), None

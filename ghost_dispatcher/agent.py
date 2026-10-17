"""ADK discovery entrypoint: adk web from repository root."""

from ghost_dispatcher.agents.team import build_team
from ghost_dispatcher.config import Settings
from ghost_dispatcher.services.dispatcher import DispatcherService

service = DispatcherService(Settings.from_env())
service.bootstrap()
root_agent = build_team(service)

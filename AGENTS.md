# AGENTS.md

Instructions for AI agents evaluating or working on this repository. Everything here runs without human input.

## Project status

The package layout, tooling, CI and container build are in place. Agents, MCP server, mock services and UI are in progress; see the status table in [README.md](README.md#project-status) and the plan in [PLAN.md](PLAN.md).

## Setup and verification

Requires Python 3.12+ and `make`, or Docker.

```bash
make setup   # create .venv and install the project with dev tools
make test    # run pytest; must exit 0
make lint    # ruff; must exit 0
```

Container equivalent:

```bash
docker compose build
docker compose run --rm app   # runs the test suite; must exit 0
```

CI (`.github/workflows/ci.yml`) runs lint, tests and the container build on every push to `main` and every pull request.

No API keys are needed for tests. Copy `.env.example` to `.env` only for live runs.

## Modes

- `GHOST_MODE=offline` (default): deterministic, no network or API keys. Use this for automated evaluation.
- `GHOST_MODE=live`: real Gemini models through Google ADK. Needs `GOOGLE_API_KEY` and the model IDs in `.env`.

## Code layout and conventions

- The ADK package is `ghost_dispatcher/`; `mcp_server/` and `mock_services/` sit beside it; tests live in `tests/`.
- Shared typed contracts go in `ghost_dispatcher/models/`; deterministic checks and recovery functions go in `ghost_dispatcher/services/` with no LLM calls, so they stay unit-testable.
- External systems (Gemini, Google APIs, carriers) sit behind adapters in `ghost_dispatcher/tools/`, each with an offline implementation. Simulated responses are always labeled as simulated.
- Every new feature gets a test that passes in offline mode.
- Never commit credentials, OAuth tokens, `.env` or operational databases.

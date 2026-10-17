# AGENTS.md

Instructions for AI agents evaluating or working on this repository. Everything here runs without human input.

## Project status

The agent/backend core, collected dataset adapter, offline demo, API, MCP, recovery, feedback and the browser control room (`ui/`) are implemented. Credentialed Gemini/Google verification remains. See [README.md](README.md), [docs/BACKEND.md](docs/BACKEND.md) and [PLAN.md](PLAN.md).

## Setup and verification

Requires Python 3.12+, Node.js 18+ with npm, and `make`, or Docker (Python only).

```bash
make setup      # create .venv and install the project with dev tools
make ui-setup   # npm ci for the control room in ui/
make verify     # lint + tests + offline demo + agent evals + UI typecheck/build; must exit 0
```

Individual steps, each must exit 0:

```bash
make lint       # ruff
make test       # pytest (offline, no keys)
make demo       # offline ADK handover, carrier outage recovery, feedback cost change
make eval       # ADK eval set: trajectory, groundedness, truthfulness, hallucination, PII blocks, A2A
make ui-build   # tsc --noEmit && vite build in ui/
```

To run the app (no keys): `make api` in one terminal, `make ui` in another, open http://localhost:5173. Switch the top-bar **Demo | Live** toggle to Live, click **Use sample evidence** to upload driver evidence, then **Simulate breakdown**. During the booking pause click **Kill provider** to see self-healing; after rating, **Run comparable incident** shows the learned decision (`POST /api/demo/reset`, offline only). Details: README sections 2–3.

Container equivalent:

```bash
docker compose build
docker compose run --rm app   # runs the test suite; must exit 0
```

CI (`.github/workflows/ci.yml`) runs lint, tests, the offline demo, the UI typecheck/build and the container build on every push to `main` and every pull request.

No API keys are needed for tests. Copy `.env.example` to `.env` only for live runs.

## Modes

- `GHOST_MODE=offline` (default): deterministic, no external network or API keys. Local MCP tests use loopback. Use this for automated evaluation.
- `GHOST_MODE=live`: real Gemini models through Google ADK. Needs `GOOGLE_API_KEY` and the model IDs in `.env`.

## Code layout and conventions

- The ADK package is `ghost_dispatcher/`; `mcp_server/` and `mock_services/` sit beside it; tests live in `tests/`.
- The browser control room is `ui/` (React + Vite + TypeScript). It renders typed `GhostEvent`s (`ui/src/lib/contract.ts`) from either the scripted demo engine (`ui/src/lib/demo/`) or the backend adapter (`ui/src/lib/live.ts`).
- Shared typed contracts go in `ghost_dispatcher/models/`; deterministic checks and recovery functions go in `ghost_dispatcher/services/` with no LLM calls, so they stay unit-testable.
- External systems (Gemini, Google APIs, carriers) sit behind adapters in `ghost_dispatcher/tools/`, each with an offline implementation. Simulated responses are always labeled as simulated.
- Every new feature gets a test that passes in offline mode.
- Never commit credentials, OAuth tokens, `.env` or operational databases.

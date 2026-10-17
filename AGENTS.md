# AGENTS.md

Instructions for AI agents evaluating or working on this repository. Everything here runs without human input.

## Project status

Bootstrap only. The package structure, tooling and a smoke test exist; the agents and demo are not implemented yet. The full design is in [docs/IDEA.md](docs/IDEA.md).

## Setup and verification

Requires Python 3.11+ and `make`.

```bash
make setup   # create .venv and install the project with dev tools
make test    # run pytest; must exit 0
make lint    # ruff; must exit 0
```

No API keys are needed for `make test`. Copy `.env.example` to `.env` only for live runs.

## Modes

- `GHOST_MODE=offline` (default): deterministic, no network or API keys. Use this for automated evaluation.
- `GHOST_MODE=live`: real Gemini models through Google ADK. Needs `GOOGLE_API_KEY`.

## Code layout and conventions

- Source lives in `src/ghost_dispatcher/`, tests in `tests/`.
- `core/` holds pure domain logic with no network or LLM calls; keep it that way so it stays unit-testable.
- External systems (Gemini, Google Maps, carriers) sit behind adapters, each with an offline implementation.
- Every new feature gets a test that passes in offline mode.

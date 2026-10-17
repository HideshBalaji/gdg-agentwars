# Ghost Dispatcher

> When a vaccine truck breaks down at 2 AM, Ghost Dispatcher coordinates a rescue before a human dispatcher wakes up, and recovers when its own tools fail.

GDG **Agent Wars** entry for the problem statement **"Logistics Handler"**.

A planned self-healing, multi-agent control room for **cold-chain logistics**, built with **Google ADK, Python, and Gemini**.

**Detect → understand → re-plan → validate → act → notify → learn.**

Specialists own conversations and hand over to peers or the dispatcher. They handle multimodal intake, route/risk analysis, negotiation, Google integrations, validation, recovery, and feedback.

Read the [implementation plan](PLAN.md), including the [team split](PLAN.md#13-team-split-and-milestones) and [three-minute demo](PLAN.md#14-three-minute-demo). Real incidents behind the problem are collected in [docs/evidence.md](docs/evidence.md).

## Status

Bootstrap: the package skeleton, tooling and a smoke test exist; the application is not runnable yet. The first version uses synthetic cargo, simulated carrier bookings, and dedicated Google demo resources.

The completed README will contain A–Z setup, credentials, seed data, one-command startup, API/MCP usage, feedback/recovery demos, tests, and troubleshooting.

## Quickstart

Requires Python 3.12+ and `make`.

```bash
make setup   # creates .venv and installs dependencies
make test    # runs the test suite, no API keys needed
```

Configuration lives in `.env` (copy from `.env.example`). `GHOST_MODE=offline` runs deterministically with no API keys; `GHOST_MODE=live` uses real Gemini models and needs `GOOGLE_API_KEY`.

## Repository layout

```text
ghost_dispatcher/
├── agents/          # ADK specialist and coordinator agents (owner: C)
├── models/          # shared typed contracts (owner: D)
├── services/        # operations, booking, recovery (owner: D)
├── tools/           # Google adapters (owner: D)
└── memory/          # preferences, provider health
mcp_server/          # logistics-mcp (owner: D)
mock_services/       # carrier API with /kill and /revive, sensor simulator (owner: D)
ui/                  # browser control room (owner: A)
data/                # synthetic fixtures and media (owner: B)
evals/               # ADK agent evaluations
tests/               # pytest suite
docs/                # evidence, architecture, demo script
PLAN.md              # implementation plan
AGENTS.md            # instructions for AI agents working on or evaluating this repo
```

## For AI evaluators

Read [AGENTS.md](AGENTS.md). It lists the exact commands to set up, run and verify the project without human input.

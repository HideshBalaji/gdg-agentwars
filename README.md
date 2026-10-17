# Ghost Dispatcher

> When a vaccine truck breaks down at 2 AM, Ghost Dispatcher saves the cargo before a human even wakes up, and fixes itself if its own tools fail.

GDG **Agent Wars** entry for the problem statement **"Logistics Handler"**.

Ghost Dispatcher is a self-healing, multi-agent control room for **cold-chain logistics**, built on **Google ADK** and **Gemini**. When a delivery goes wrong (a truck breaks down, a fridge fails, a customer is unavailable, a package arrives damaged), it runs one loop:

```
detect → understand → re-plan → act → notify → learn
```

> **Status: bootstrap.** This commit sets up the project structure only. Agents, MCP server, mock services and the demo are not implemented yet. See [docs/IDEA.md](docs/IDEA.md) for the full design and build plan.

## Quickstart

Requires Python 3.11+.

```bash
make setup   # creates .venv and installs dependencies
make test    # runs the test suite, no API keys needed
```

Configuration lives in `.env` (copy from `.env.example`). `GHOST_MODE=offline` runs deterministically with no API keys. `GHOST_MODE=live` uses real Gemini models and needs `GOOGLE_API_KEY`.

## Judging criteria → where they are covered (planned)

| Criterion | Where |
|---|---|
| Multi-model / multimodal agents | `src/ghost_dispatcher/agents/` (Gemini Pro for planning, Flash for photos/voice/PDFs) |
| Conversational agent | `agents/negotiator` (carriers and customers) |
| API calls | Google Maps, mock carrier API, notifications |
| MCP integration | `src/ghost_dispatcher/mcp_server/` (logistics-mcp) |
| Feedback loop | `agents/critic` + memory store |
| Self-healing | `agents/watchdog` + `agents/validator`, carrier API `/kill` switch |

## Repository layout

```
src/ghost_dispatcher/
├── agents/          # Google ADK agents
├── core/            # domain models, spoilage math, plan validation (pure, testable)
├── mcp_server/      # logistics-mcp server
└── mock_services/   # carrier API with /kill switch, temperature feed
data/                # seed fixtures
docs/IDEA.md         # full design, build plan, demo script
tests/               # pytest suite
AGENTS.md            # instructions for AI agents working on or evaluating this repo
```

## For AI evaluators

Read [AGENTS.md](AGENTS.md). It lists the exact commands to set up, run and verify the project without human input.

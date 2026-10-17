# Ghost Dispatcher

[![CI](https://github.com/HideshBalaji/gdg-agentwars/actions/workflows/ci.yml/badge.svg)](https://github.com/HideshBalaji/gdg-agentwars/actions/workflows/ci.yml)

> When a vaccine truck breaks down at 2 AM, Ghost Dispatcher coordinates a rescue before a human dispatcher wakes up, and recovers when its own tools fail.

GDG **Agent Wars** entry for the problem statement **"Logistics Handler"**.

Ghost Dispatcher is an autonomous, self-healing multi-agent system for **cold-chain logistics incidents**, built with **Google ADK, Python and Gemini**. A team of specialist agents takes a delivery incident from raw evidence (a driver's photo, a voice note, a temperature feed) to a validated rescue: a replacement reefer truck, a carrier booking, a rebooked dock slot and notified stakeholders. Every outcome feeds back into the next decision.

**Implemented core:** offline ADK conversations and specialist handovers, validated plans, simulated carrier fallback, transactional cargo/dock assignments, feedback, authenticated API, uploads, replayable events and MCP. The collected 10-truck/20-shipment dataset is integrated. Live Gemini/Google adapters require credentials and a separate live rehearsal; offline tests do not claim those services ran. All cargo and carrier bookings remain simulated. UI, Live voice, weather and extra incident actions are still in progress or planned.

**UI teammate:** [API/event contract](docs/BACKEND.md#ui-contract). **Data teammate:** [dataset adapter and schema](docs/BACKEND.md#data-contract). See the [backend guide](docs/BACKEND.md) for end-to-end setup, Google authorization, recovery, feedback and troubleshooting.

## The incident loop

**Detect → understand → re-plan → validate → act → notify → learn.**

1. **Detect:** a driver report, sensor alert or customer message opens an incident.
2. **Understand:** Gemini multimodal intake turns photos, voice notes, PDFs and sensor traces into a typed `Incident` with evidence provenance.
3. **Re-plan:** route/risk analysis reads fleet, hub and carrier state through the `logistics-mcp` server and ranks candidate rescues by time, cost and risk.
4. **Validate:** deterministic checks (refrigeration, capacity, availability, rescue window, driver hours) gate every plan; failures loop back to planning, at most three times.
5. **Act:** the negotiator books a carrier through the carrier API and reassigns the load, with idempotency keys and durable receipts.
6. **Notify:** Google Sheets, Calendar and Gmail adapters update the fleet board, dock slots and recipients.
7. **Learn:** ratings and outcomes become typed ranking preferences that shape the next incident.

## Agents

| Agent | Gemini role | Responsibility |
|---|---|---|
| dispatcher | Pro | Owns the incident, delegates to specialists, picks the validated plan, applies learned preferences |
| intake | Flash | Multimodal parsing of photos, voice notes, PDFs and sensor data into a structured incident |
| route_risk | Flash | Maps routing and rescue-window calculation; weather planned |
| negotiator | Flash chat; Live planned | Booking conversations; customer rescheduling planned |
| comms | Flash | Sheets fleet board, Calendar dock slots, Gmail notifications |
| validator | Code + Flash | Hard constraint checks before any action |
| watchdog | Code + Flash | Tool-failure detection, recovery and the Healing Log |
| critic | Flash | Converts ratings and outcomes into constrained preferences |

Specialists own the conversation while they work and hand over to peers or back to the dispatcher through ADK agent transfer.

## Self-healing

Every recovery step is recorded in a **Healing Log** with the incident, tool, failure category, remedy and result.

| Level | Behavior |
|---|---|
| Retry | Bounded backoff for transient errors and rate limits |
| Provider fallback | Primary carrier → backup carrier, after reconciling ambiguous outcomes; Gmail booking fallback planned |
| Validation loop | Rejected plans return to planning through an ADK `LoopAgent` (max three iterations) |
| Tool-call repair | One corrected retry for schema mistakes, never inventing identifiers |
| Learned workaround | Unhealthy providers are skipped until an expiry-based recovery probe succeeds |

The mock carrier API exposes `POST /kill` and `POST /revive` so a provider outage can be injected mid-booking and the recovery observed end to end.

## MCP tools (`logistics-mcp`)

| Tool | Purpose |
|---|---|
| `get_shipment` | Cargo, weight, temperature policy, destination, deadlines |
| `list_trucks_near` | Available trucks with capacity and refrigeration |
| `assign_load` | Validated, replay-safe reassignment |
| `get_temperature_history` | Timestamped reefer readings |
| `find_cold_hubs_near` | Hubs with free, compatible cold storage |
| `book_dock_slot` | Read the dock receipt reserved atomically with load assignment |
| `list_carriers` | Cost, reliability, capabilities, service health |
| `log_incident` | Incident, plan, actions, healing history and outcome |

The server is built with the official MCP Python SDK; ADK agents discover and call these tools over MCP.

## Judging criteria → evidence

| Criterion | Evidence in this project |
|---|---|
| Multi-model / multimodal agents | Gemini Pro + Flash roles; photo, voice, PDF and sensor intake; optional Gemini Live voice |
| Conversational agents | Specialist conversation ownership, follow-up questions, peer handovers, carrier/customer negotiation |
| API calls | Routes, Sheets, Calendar, Gmail adapters and mock carrier booking/status; Places/Weather planned |
| MCP integration | `logistics-mcp` server with tool discovery and call traces |
| Feedback loop | Rating → validated preference → memory → changed ranking on the next comparable incident |
| Self-healing | Carrier outage injected mid-booking; fallback, reconciliation and Healing Log |
| A–Z instructions | This README, [AGENTS.md](AGENTS.md), one-command local and container runs, CI |

## Quickstart

Requirements: Python 3.12+ and `make`, or Docker.

**Local**

```bash
make setup   # create .venv and install the project with dev tools
make test    # pytest, offline, no API keys
make lint    # ruff
make demo    # offline ADK handover + carrier outage + feedback comparison
make api     # UI backend and OpenAPI at http://127.0.0.1:8000/docs
# Another terminal: make mcp
```

**Docker**

```bash
docker compose build
docker compose run --rm app   # runs the test suite inside the container
```

For a locked Python 3.12 environment with [uv](https://docs.astral.sh/uv/): `uv sync --python 3.12 --extra dev --frozen`, then use the same `make` commands. MCP is pinned below 2 for its FastMCP 1.x API.

## Configuration

Copy `.env.example` to `.env`. Tests and offline runs need no keys.

| Variable | Purpose |
|---|---|
| `GHOST_MODE` | `offline` (deterministic, no external calls) or `live` (real Gemini through ADK) |
| `GOOGLE_API_KEY` | Gemini API key from Google AI Studio, live mode only |
| `GOOGLE_GENAI_USE_VERTEXAI` | `FALSE` for AI Studio keys |
| `GEMINI_PRO_MODEL`, `GEMINI_FLASH_MODEL`, `GEMINI_LIVE_MODEL` | Model IDs per agent role |
| `GOOGLE_MAPS_API_KEY` | Required for live routing; offline routes are explicitly simulated |
| `GHOST_DATASET`, `GHOST_DATA_DIR`, `GHOST_SEED_FILE` | Collected replay pack (default), builtin developer fixture, or normalized custom seed |
| `GHOST_DATABASE`, `GHOST_API_TOKEN`, `GHOST_UI_ORIGIN` | Runtime storage, bearer authorization, frontend origin |
| `GHOST_API_URL`, `GHOST_MCP_URL`, `GHOST_CARRIER_URL` | Local backend, MCP and mock carrier addresses |
| `GOOGLE_OAUTH_TOKEN_FILE`, `GOOGLE_SHEET_ID`, `GOOGLE_CALENDAR_ID`, `GOOGLE_DEMO_RECIPIENT` | Dedicated Google demo resources; full setup in the backend guide |

## Tech stack

Google ADK · Gemini (AI Studio) · MCP Python SDK · Pydantic · FastAPI · httpx · SQLite (optional Firestore) · Google Maps, Sheets, Calendar, Gmail APIs · pytest · ruff · Docker · GitHub Actions

## Project status

| Area | State |
|---|---|
| Package layout, tooling, CI, container build | Done |
| Demo data: seed fleet, scenarios, sensor traces, photos, voice notes, documents ([data/](data/README.md)) | Done |
| Shared models/services, API/MCP, mock carrier, collected sensor replay | Offline core implemented and tested |
| ADK agents, Healing Log, feedback memory | Offline core implemented and tested |
| Gemini, Maps, Sheets, Calendar, Gmail live adapters | Implemented; credentialed verification pending |
| Browser control room UI, Live voice and extra incidents | Separate workstreams / planned |

Ownership, milestones and the demo script are in [PLAN.md](PLAN.md). Real incidents behind the problem are in [docs/evidence.md](docs/evidence.md).

## Repository layout

```text
ghost_dispatcher/        # ADK package
├── agents/              # dispatcher and specialist agents
├── models/              # shared typed contracts
├── services/            # validation, booking, recovery (no LLM calls)
├── tools/               # Google API adapters with offline implementations
└── memory/              # preferences and provider health
mcp_server/              # logistics-mcp server
mock_services/           # carrier API with /kill and /revive, sensor simulator
data/                    # synthetic seed fleet, scenarios, sensor traces, media, references
tests/                   # pytest suite, including data contract checks
docs/                    # supporting documents
.github/workflows/ci.yml # lint, tests and container build on every push and PR
Dockerfile, compose.yaml # container build and run
PLAN.md                  # implementation plan and team split
AGENTS.md                # instructions for AI agents working on or evaluating this repo
```

## For AI evaluators

Read [AGENTS.md](AGENTS.md) for the exact commands to set up, run and verify the project without human input.

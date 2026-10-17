# Ghost Dispatcher

[![CI](https://github.com/HideshBalaji/gdg-agentwars/actions/workflows/ci.yml/badge.svg)](https://github.com/HideshBalaji/gdg-agentwars/actions/workflows/ci.yml)

> When a vaccine truck breaks down at 2 AM, Ghost Dispatcher coordinates a rescue before a human dispatcher wakes up, and recovers when its own tools fail.

GDG **Agent Wars** entry for the problem statement **"Logistics Handler"**. Built with **Google ADK, Python, Gemini, MCP, FastAPI and a React control room**.

Ghost Dispatcher is a self-healing, multi-agent system for **cold-chain logistics incidents**. Specialist agents take an incident from raw evidence (a driver's photo, a voice note, a temperature feed) to a validated rescue: a replacement reefer truck, a carrier booking, a rebooked dock slot and notified stakeholders. When a carrier API fails mid-booking, it retries, falls back and finishes anyway. A human rating becomes a stored preference that changes the next decision.

All cargo, carrier bookings and Google actions in offline mode are **simulated and labelled as simulated**. Nothing here is a medical or legal determination.

---

## Contents

1. [Run it in 5 commands (no API keys)](#1-run-it-in-5-commands-no-api-keys)
2. [Run the full app: backend + control room](#2-run-the-full-app-backend--control-room)
3. [How it works end to end](#3-how-it-works-end-to-end)
4. [Agents, self-healing, feedback, MCP](#4-agents-self-healing-feedback-mcp)
5. [HTTP API and event stream](#5-http-api-and-event-stream)
6. [Configuration](#6-configuration)
7. [Live mode with Gemini and Google APIs](#7-live-mode-with-gemini-and-google-apis)
8. [Tests, CI and Docker](#8-tests-ci-and-docker)
9. [Troubleshooting](#9-troubleshooting)
10. [Judging criteria → evidence](#10-judging-criteria--evidence)
11. [Repository layout, status and limitations](#11-repository-layout-status-and-limitations)

---

## 1. Run it in 5 commands (no API keys)

**Prerequisites:** Python **3.12+** (CI uses 3.12; also verified on 3.14), Node.js **18+** with npm (CI uses 20), `make`, `git`. No API keys, no Google account, no network calls at runtime.

```bash
git clone https://github.com/HideshBalaji/gdg-agentwars.git
cd gdg-agentwars
make setup      # creates .venv and installs the Python package + dev tools
make ui-setup   # installs the control room's npm dependencies (npm ci)
make verify     # lint + 44 tests + offline agent demo + agent evals + UI typecheck/build
```

`make verify` must exit 0. It runs:

| Step | Command | What it proves |
|---|---|---|
| Lint | `make lint` | `ruff` passes on all Python sources |
| Tests | `make test` | `pytest`: domain rules, API, real local MCP transport, ADK handovers, carrier fallback, feedback, persistence |
| Offline demo | `make demo` | A real ADK conversation (deterministic model double) hands over to Route & Risk, the primary carrier is killed, the rescue finishes through a backup, then feedback lowers the cost of a comparable incident |
| Agent evals | `make eval` | Replays the ADK eval set through the real team: tool trajectory (incl. handovers and A2A calls), groundedness, truthfulness, hallucination and PII-block checks on 6 cases; writes `runs/eval-report.json` |
| UI build | `make ui-build` | TypeScript typecheck + production build of the control room into `ui/dist` |

Expected tail of `make demo`:

```text
[SIMULATED] Conversation owner: route_risk
[SIMULATED] Primary killed; rescue resolved via CAR-002
{
  "simulated": true,
  "baseline_cost": 18500.0,
  "learned_cost": 12000.0,
  "currency": "INR",
  "reason": "Learned preference: cheapest feasible carrier within the approved cost/time policy",
  "healing_events": 5
}
```

---

## 2. Run the full app: backend + control room

Two terminals from the repository root.

```bash
# Terminal 1: FastAPI backend on http://127.0.0.1:8000 (OpenAPI at /docs)
make api
```

```bash
# Terminal 2: control room on http://localhost:5173
make ui
```

Open **http://localhost:5173**. The dev server proxies `/api` and `/health` to `127.0.0.1:8000`, so there is no CORS setup. Optional extra processes: `make mcp` (authenticated MCP server on :8001) and `make carrier` (mock carrier HTTP API on :8002 with `/kill` and `/revive`). Offline mode needs neither.

The control room has two modes, switched with the **Demo | Live** toggle in the top bar.

### How the screen works

The screen answers one question: *what is happening right now, and what already happened?*

- **Start screen:** three steps. Attach driver evidence (optional), simulate a breakdown, then watch, break and rate it.
- **Now banner:** one plain-language sentence about what is happening this moment, which agent is acting (and which tool it is calling), and *Step n of 7*.
- **Step list:** Detect → Understand → Find options → Check and choose → Book the rescue → Notify → Learn. The live step is open and shows only what matters for it (facts, options, rejections, booking and recovery, receipts, the rating). Finished steps fold into a one-line summary; click one to reopen it.
- **Right side:** the four numbers that matter (rescue window, cargo temperature, rescue plan, self-healing) and a live map (MapLibre with CARTO light/dark basemaps; a built-in schematic is used when tiles can't load).
- **Agent log** (`L`): a drawer with the full agent conversation, every tool call (Gemini, logistics-mcp, Google, carriers), the fleet table and learned memory. The message box for chatting with the active agent lives here.
- **Systems menu:** health of every integration, with a switch to kill or revive each carrier.
- **⌘K:** every action from the keyboard.

### Live mode (real backend)

1. Switch the top-bar toggle to **Live**. Its dot turns green when the backend answers, and the map loads the backend's 10 trucks around Hosur.
2. **Multimodal evidence:** on the start screen click **Use sample evidence** to add the data team's driver evidence (`data/photos/reefer_truck.jpg` and the voice note `data/audio/breakdown.wav` with its transcript), or **Attach files** / **Record voice note** (JPEG, PNG, WAV, MP3, M4A, WebM, PDF; 10 MiB max). Each file uploads straight away to `POST /api/uploads`; a ✓ means the backend stored it.
3. Click **Simulate breakdown** (or press `1`). The UI:
   - creates an incident for `SHP-001` with the uploaded `evidence_ids` (`POST /api/incidents`) and opens its event stream; the evidence appears in the Detect step;
   - opens an ADK conversation and sends *"Plan a rescue"* (the Dispatcher hands over to Route & Risk);
   - asks the backend for a validated plan (`POST /plan`): the Check and choose step lists the rejected trucks with the validator's reasons and the chosen plan with its reason;
   - **pauses 15 seconds before booking**: the Now banner turns amber and shows **Kill provider** with a countdown.
   - If this shipment was already rescued in the current database, it first calls `POST /api/demo/reset` (offline only) so the run can repeat.
4. **Self-healing:** click **Kill provider** (or press `K`) during that pause. The backend's carrier is killed (`POST /api/demo/carriers/{id}/kill`). The Book the rescue step shows the retries failing, then a fallback, then the booking via the backup carrier. The map draws the rescue route.
5. The incident resolves through Notify (dock, fleet sheet, receiver; all simulated) to Learn.
6. **Feedback:** in the Learn step keep the reason *"Too expensive…"* and click **Needs work**. The backend stores a ranking-only preference (`GET /api/preferences`). It appears in the agent log's Memory tab as **P-001**.
7. **Learning, visible:** click **Run comparable incident** (in the Learn step, **Run comparable** in the top bar, or press `C`). The UI calls `POST /api/demo/reset`, which re-seeds the fleet, carriers and assignments to the same 02:00 snapshot but **keeps learned preferences and past incidents**. It then replays the same breakdown with every carrier healthy and no kill. The Now banner shows *Learned from your rating* and a **Decision changed by feedback** card compares the planner's first choice before the rating with now:

   | | Truck · carrier | Cost | Delivery |
   |---|---|---|---|
   | Before rating | TN-02 · CAR-001 | ₹18,500 | 07:35 |
   | After rating | TN-03 · CAR-002 | ₹12,000 | 08:50 |

   That's ₹6,500 saved for 75 minutes later, within both deadlines, with the reason *"Learned preference: cheapest feasible carrier within the approved cost/time policy"*. Because the fleet and carriers are identical, the change is attributable to the feedback alone.
8. **Chat:** open the agent log (`L`) and type *"Why this vehicle?"*. The specialist that owns the conversation answers from the backend. Any pending evidence is sent with the message (`evidence_ids`).

> **Replay note:** `POST /api/demo/reset` (offline mode only) makes runs repeatable without restarting. To also clear learned preferences and history, restart with a fresh database: `GHOST_DATABASE=runs/demo-$(date +%s).sqlite make api`.

### Demo mode (scripted, no backend)

The default mode needs no backend. Press **Simulate breakdown** (`1`) to play a richer scripted incident through the same steps: the driver's photo and a playable voice note (or the evidence you attached), Intake facts, a Maps timeout retry, two validator rejections and a re-plan (attempt 2 of 3), the booking pause with **Kill provider**, the fallback, a dock-slot argument repair, and notifications. Rate it *"too expensive"*, click **Run comparable incident**, and the Dispatcher picks the cheaper carrier (KA-11 ColdLine ₹18,400 → KA-04 FrostFleet ₹11,200), citing the learned rule in the same **Decision changed by feedback** card. Files you attach in demo mode stay in the browser. The scripted engine emits the same typed events the backend stream is mapped onto (`ui/src/lib/contract.ts`).

**Keyboard:** `1` simulate breakdown · `K` kill the carrier being booked · `C` run comparable incident · `L` agent log · `⌘K` command menu (also: playback speed, reset, theme, each carrier's kill/revive).

---

## 3. How it works end to end

Every incident runs through the same loop:

**Detect → Understand → Re-plan → Validate → Act → Notify → Learn**

The control room's step list follows this loop: the Now banner says which step is running, and each step opens while it is live.

### Architecture

```mermaid
flowchart LR
  subgraph Browser["ui/ · React control room (Vite)"]
    UI[Now banner · Step list · Metrics · Map · Agent log · Rating]
  end
  subgraph Backend["ghost_dispatcher/ · FastAPI (make api :8000)"]
    API[api.py<br/>REST + SSE]
    CONV[agents/conversations.py<br/>ADK Runner + sessions]
    TEAM[agents/team.py<br/>dispatcher + 7 specialists]
    SVC[services/dispatcher.py<br/>plan · validate · execute · feedback]
    REC[services/recovery.py<br/>retry · circuit · fallback]
    STORE[(SQLite<br/>records · events · preferences)]
  end
  MCP[mcp_server/ · logistics-mcp<br/>make mcp :8001]
  CAR[mock_services/carrier_api.py<br/>/kill /revive · make carrier :8002]
  G[tools/google.py<br/>Sheets · Calendar · Gmail]
  R[tools/routing.py<br/>Maps Routes or collected fixture]
  GEM[Gemini Pro / Flash<br/>live mode]

  UI -- "fetch /api/*  (Bearer token)" --> API
  API -- "SSE /api/incidents/{id}/events" --> UI
  API --> CONV --> TEAM
  TEAM -- live --> GEM
  TEAM -- tools --> SVC
  TEAM -. read-only MCP tools .-> MCP
  API --> SVC
  SVC --> REC --> CAR
  SVC --> R
  SVC --> G
  SVC <--> STORE
  MCP --> SVC
```

### One incident, step by step

```mermaid
sequenceDiagram
  participant U as Control room (ui/)
  participant A as FastAPI api.py
  participant D as ADK agents
  participant S as DispatcherService
  participant C as Carrier (mock)
  U->>A: POST /api/uploads (driver photo, voice note) → evidence ids
  U->>A: POST /api/incidents {shipment_id, type, description, evidence_ids}
  A-->>U: incident (SSE: incident.created)
  U->>A: GET /api/incidents/{id}/events?follow=true (stream stays open)
  U->>A: POST /api/conversations, then /messages "Plan a rescue"
  A->>D: Dispatcher → transfer to route_risk (SSE: handover, message)
  U->>A: POST /api/incidents/{id}/plan
  A->>S: candidates → hard checks → rank with preferences
  S-->>U: SSE: validation (rejected + reasons), plan.created (chosen + reason)
  Note over U: 15 s window: presenter may click Kill provider
  U->>A: POST /api/demo/carriers/CAR-001/kill (optional)
  U->>A: POST /api/incidents/{id}/execute
  A->>S: book with idempotency key
  S->>C: book CAR-001 ✗ ×3 (SSE: healing retry)
  S->>S: circuit open → re-plan without CAR-001 (SSE: healing fallback, validation, plan.created)
  S->>C: book CAR-002 ✓ (SSE: healing recovered)
  S-->>U: SSE: action.completed (load + dock), integration.completed (Sheets/Calendar/Gmail), incident.resolved
  U->>A: POST /api/incidents/{id}/feedback {rating, reason, prefer_cheaper_when_slack}
  A-->>U: SSE: feedback.saved → UI reads GET /api/preferences
  U->>A: POST /api/demo/reset (keeps preferences), then the same incident again
  A-->>U: plan.created: cheaper carrier, reason "Learned preference…" → before/after card
```

### What each stage does

| Stage | Backend | Control room |
|---|---|---|
| **Detect** | `POST /api/incidents` persists the incident and emits `incident.created` | Detect step with the driver report and evidence, red pulse on the broken truck, rescue-window countdown from the shipment's cold-restore deadline |
| **Understand** | The ADK Dispatcher reads the incident and transfers to a specialist. In live mode Intake reads uploaded photos/audio/PDFs with Gemini; offline mode never invents evidence | Understand step with the extracted facts; the Now banner names the agent that owns the conversation |
| **Re-plan** | Route & Risk computes candidates from fleet, hubs, sensors and routes (collected fixture offline, Maps Routes live) | Find options step: options table with time, cost, slack |
| **Validate** | Deterministic code rejects plans that fail reefer, capacity, availability, rescue-window or driver-hour checks (`services/validation.py`). Agent planning is wrapped in a `LoopAgent` (max 3 iterations) | Check and choose step: rejected options with the validator's reasons, and the chosen plan with its ranking reason |
| **Act** | Books the carrier with an idempotency key, then reassigns the load and dock atomically. Failures go through `services/recovery.py` | Book the rescue step: recovery cards (retry → fallback → recovered), booking and assignment receipts; rescue route on the map |
| **Notify** | Sheets fleet board, Calendar dock event, Gmail notification (`tools/google.py`, simulated offline). Failed syncs become retryable jobs | Notify step: receipts for each integration; *pending* if a sync is pending |
| **Learn** | Feedback becomes a typed, scoped, expiring ranking preference. Hard checks never change. `POST /api/demo/reset` restores the fleet but keeps preferences, so a comparable incident can be replayed | Learn step: rating → stored rule → **Run comparable incident** → *Decision changed by feedback* (before vs. after) |

---

## 4. Agents, self-healing, feedback, MCP

### Agents (`ghost_dispatcher/agents/team.py`)

| Agent | Gemini role (live) | Responsibility |
|---|---|---|
| dispatcher | Pro | Owns the incident, delegates to specialists, picks the validated plan, applies learned preferences |
| intake | Flash | Multimodal parsing of photos, voice notes, PDFs and sensor data into a structured incident |
| route_risk | Flash | Routing and rescue-window calculation, candidate ranking |
| negotiator | Flash | Carrier booking and customer conversations |
| comms | Flash | Sheets fleet board, Calendar dock slots, Gmail notifications |
| validator | Code + Flash | Hard constraint checks before any action |
| watchdog | Code + Flash | Tool-failure detection, recovery and the healing log |
| critic | Flash | Turns ratings and outcomes into constrained preferences |

Specialists own the conversation while they work and hand over to peers or back to the dispatcher through ADK agent transfer (max 4 transfers per message). Send `target_agent` in a chat message to ask for a specific specialist. `ghost_dispatcher/agent.py` exposes `root_agent`, so `adk web` from the repository root also works for trace inspection.

### Self-healing

| Level | Behavior | Where you see it |
|---|---|---|
| Retry | Bounded backoff for connection/unavailability errors (up to 3 attempts) | *Retry* cards in the Book the rescue step and agent log |
| Provider fallback | Circuit opens for the failed carrier (60 s); re-plan through the next feasible carrier; ambiguous outcomes are reconciled by booking ID, never double-booked | *Fallback* card → *Recovered*; the Now banner turns amber while recovering |
| Validation loop | Rejected plans go back to planning (`LoopAgent`, ≤ 3 iterations); code checks every plan regardless of which agent proposed it | Rejected options with reasons in the Check and choose step |
| Tool-call repair | One corrected attempt per tool/message after a schema error, never inventing identifiers | *Repair* card in the agent log (demo mode) |
| Learned workaround | Provider health and circuit state persist, so unhealthy carriers are skipped until revived/probed | The Systems menu shows the carrier switched off and a red dot |

Kill and revive carriers from the **Kill provider** callout or the Systems menu, from `POST /api/demo/carriers/{CAR-00x}/kill|revive`, or from the standalone mock (`make carrier`, then `POST :8002/kill`).

### Feedback loop

1. Rate the incident 👍/👎 with a reason (`POST /api/incidents/{id}/feedback`).
2. With `prefer_cheaper_when_slack: true` (the UI sets it when the reason mentions cost), the backend activates the collected pack's policy: *save at least INR 5,000 for at most 90 minutes of later delivery, within both deadlines*, scoped to customer, cargo profile and currency, with an expiry.
3. The next comparable incident's ranking applies it after every hard check passes. `make demo` proves it: TN-02 / CAR-001 (INR 18,500) → TN-03 / CAR-002 (INR 12,000).
4. Free-text feedback is stored, never executed as instructions.

### MCP: `logistics-mcp` (`mcp_server/server.py`, `make mcp`)

Built with the official MCP Python SDK (FastMCP), served over streamable HTTP at `http://127.0.0.1:8001/mcp`. It requires `Authorization: Bearer ghost-demo` offline.

| Tool | Purpose |
|---|---|
| `get_shipment` | Cargo, weight, temperature policy, destination, deadlines |
| `list_trucks_near` | Available trucks with capacity and refrigeration |
| `assign_load` | Validated, replay-safe reassignment (forwards to the API worker) |
| `get_temperature_history` | Timestamped reefer readings |
| `find_cold_hubs_near` | Hubs with free, compatible cold storage |
| `book_dock_slot` | Dock receipt reserved atomically with load assignment |
| `list_carriers` | Cost, reliability, capabilities, service health |
| `log_incident` | Incident, plan, actions, healing history and outcome |

---

## 5. HTTP API and event stream

All `/api/*` routes need `Authorization: Bearer ghost-demo` offline. Only `/health` is public. Full contract: [docs/BACKEND.md](docs/BACKEND.md#ui-contract) and `http://127.0.0.1:8000/docs`.

| Method and path | Purpose |
|---|---|
| `GET /health` | `{"status":"ok","mode":"offline"}` |
| `GET /api/fleet` | Trucks, shipments, carriers, warehouses, dataset and decision clock |
| `POST /api/uploads` | Multipart evidence (JPEG/PNG/WAV/MP3/M4A/WebM/PDF, ≤ 10 MiB) |
| `POST /api/incidents` | `{shipment_id, type, description, evidence_ids}` → incident |
| `POST /api/incidents/{id}/plan` | Validated candidates + chosen plan (no booking) |
| `POST /api/incidents/{id}/execute` | Book, assign, reserve dock, sync Google; repeat-safe |
| `POST /api/conversations` · `POST /api/conversations/{id}/messages` | ADK conversation with specialist ownership |
| `GET /api/incidents/{id}/events?after=0&follow=true` | Server-sent events with durable IDs (replay with `after` or `Last-Event-ID`) |
| `POST /api/incidents/{id}/feedback` · `GET /api/preferences` | Ratings and learned ranking preferences |
| `POST /api/demo/carriers/{id}/kill` · `/revive` | Simulated carrier fault controls |
| `POST /api/demo/reset` | Offline only: re-seed fleet, carriers and assignments; keep preferences, feedback, incidents and evidence |

Try it with curl while `make api` runs:

```bash
curl -s http://127.0.0.1:8000/health
curl -s -H 'Authorization: Bearer ghost-demo' -H 'Content-Type: application/json' \
  -d '{"shipment_id":"SHP-001","type":"truck_breakdown","description":"TN-07 breakdown near Hosur","evidence_ids":[]}' \
  http://127.0.0.1:8000/api/incidents
```

### How the control room renders backend events (`ui/src/lib/live.ts`)

| SSE `type` | UI effect |
|---|---|
| `incident.created` | (UI opens the incident from the `POST` response) |
| `handover` | Owner shown in the Now banner; handover line in the agent log |
| `message` | Agent message in the agent log and the step's quote (plan JSON is summarised into a sentence) |
| `validation` | Rejected options with reasons; rescue deadline; feasible count |
| `plan.created` | Options table, chosen plan and reason, map framing of the rescue truck |
| `healing` | Recovery cards: retry attempts, fallback, recovered; amber Now banner while recovering; toast on fallback |
| `action.completed` | Load assignment + dock receipt; rescue truck drives on the map |
| `integration.completed` / `integration.pending` | Sheets, Calendar, Gmail receipts (confirmed or pending) |
| `incident.resolved` | Outcome toast, step → Learn, rating card |
| `feedback.saved` | Reads `/api/preferences` and shows the stored rule |

The UI's own typed contract (`GhostEvent` in `ui/src/lib/contract.ts`) is what both the live adapter and the scripted demo engine emit, so every panel works in both modes.

---

## 6. Configuration

Backend settings come from environment variables (copy `.env.example` to `.env` to change them). Offline runs need none of them.

| Variable | Default | Purpose |
|---|---|---|
| `GHOST_MODE` | `offline` | `offline` (deterministic, no external calls) or `live` (Gemini through ADK) |
| `GHOST_API_TOKEN` | `ghost-demo` | Bearer token for `/api/*` and MCP. Live mode requires a private value of ≥ 24 chars |
| `GHOST_DATABASE` | `runs/ghost.sqlite` | SQLite file; use a fresh path to replay demos |
| `GHOST_DATASET` / `GHOST_DATA_DIR` / `GHOST_SEED_FILE` | `collected` / `data` / empty | Team-collected pack (10 trucks, 20 shipments, 3 carriers, 3 hubs), the `builtin` developer fixture, or a custom normalized seed |
| `GHOST_UI_ORIGIN` | `http://localhost:3000` | CORS origin if the UI calls the API directly instead of through the Vite proxy |
| `GHOST_API_URL` / `GHOST_MCP_URL` / `GHOST_CARRIER_URL` | `:8000` / `:8001/mcp` / `:8002` | Local service addresses |
| `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI` | empty, `FALSE` | Gemini via AI Studio (live only) |
| `GEMINI_PRO_MODEL`, `GEMINI_FLASH_MODEL`, `GEMINI_LIVE_MODEL` | empty | Model IDs per agent role (live only) |
| `GOOGLE_MAPS_API_KEY` | empty | Routes API (live only) |
| `GOOGLE_OAUTH_TOKEN_FILE`, `GOOGLE_SHEET_ID`, `GOOGLE_CALENDAR_ID`, `GOOGLE_DEMO_RECIPIENT` | empty | Dedicated Google Workspace demo resources (live only) |

Control room settings (`ui/.env.example`, copy to `ui/.env.local`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_DEFAULT_MODE` | `demo` | Start in `demo` or `live` |
| `VITE_API_TOKEN` | `ghost-demo` | Must match `GHOST_API_TOKEN` |
| `VITE_API_URL` | empty | Empty = use the Vite proxy; set `GHOST_API=http://host:port` when starting `make ui` to proxy elsewhere |

---

## 7. Live mode with Gemini and Google APIs

Offline mode is the evaluated path. Live mode uses real Gemini models and Google APIs and needs credentials:

1. Set `GHOST_MODE=live`, `GOOGLE_API_KEY` ([AI Studio](https://aistudio.google.com/apikey)), `GEMINI_PRO_MODEL` and `GEMINI_FLASH_MODEL` ([model catalog](https://ai.google.dev/gemini-api/docs/models)).
2. Set a private `GHOST_API_TOKEN` (≥ 24 chars) and the same value as `VITE_API_TOKEN` for the UI.
3. Enable the Routes API and set `GOOGLE_MAPS_API_KEY`.
4. Enable the Sheets, Calendar and Gmail APIs, create the dedicated Sheet (tabs **Incidents** and **Fleet**) and Calendar, and generate a user OAuth token file stored outside the repo (`GOOGLE_OAUTH_TOKEN_FILE`).
5. Start `make carrier`, `make mcp`, then `make api`, then `make ui`.

The step-by-step guide, OAuth scopes and reconciliation rules are in [docs/BACKEND.md](docs/BACKEND.md#live-gemini-and-google-setup). Offline tests do not claim that Gemini or Google ran.

---

## 8. Tests, CI and Docker

```bash
make test        # pytest, offline
make lint        # ruff
make demo        # offline end-to-end agent demo (also scripts/demo.sh)
make ui-build    # UI typecheck + build
make eval        # ADK eval set: trajectory, groundedness, truthfulness, hallucination, PII, A2A
make carrier-agent  # the carrier's booking agent over A2A on :8003 (optional)
make verify      # lint, test, demo, eval, ui-build
```

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request: Python lint, tests, the offline demo and the agent evals on 3.12; the UI typecheck and build on Node 20; and a container build that runs the tests.

```bash
docker compose build
docker compose run --rm app   # runs pytest inside the container
```

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `cd: no such file or directory: ui` | Run commands from the repository root (`gdg-agentwars/`). `ui/` is inside it |
| The Live toggle's dot is red | Start `make api` first, then switch to Live again. Check `curl http://127.0.0.1:8000/health` |
| Chat or toast says *already rescued* / `sensor_data_missing` | That shipment was rescued in this database. Restart with `GHOST_DATABASE=runs/demo-$(date +%s).sqlite make api` |
| Kill had no effect | Click **Kill provider** in the Now banner (or press `K`) during the 15 s pause before booking. Killing after booking does nothing |
| Map shows a plain schematic instead of streets | The CARTO basemap tiles need internet access; the schematic is the offline fallback and shows the same trucks, hubs and routes |
| **Use sample evidence** shows *Samples unavailable* | Start the UI with `make ui` (or `make ui-preview`); the dev server serves `/samples` from `data/` |
| Upload shows a red ✗ | Hover it for the reason: unsupported type, over 10 MiB, or the backend isn't running |
| 🎙 does nothing | Allow microphone access for `localhost:5173` in the browser |
| `401 unauthorized` | `VITE_API_TOKEN` (UI) must equal `GHOST_API_TOKEN` (backend) |
| Port 5173 or 8000 in use | Stop the other process; Vite will otherwise pick the next free port |
| `npm ci` fails | Use Node 18+ (`node -v`) |
| `make setup` fails | Use Python 3.12+ (`python3 --version`), or `uv sync --python 3.12 --extra dev --frozen` |

---

## 10. Judging criteria → evidence

| Criterion | Evidence | How to see it |
|---|---|---|
| Multi-model / multimodal agents | Gemini Pro + Flash roles; photo, voice, PDF and sensor intake; uploads endpoint | Live mode: **Use sample evidence** / **Attach files** / **Record voice note** → `POST /api/uploads` → evidence on the incident and passed to Gemini Intake; the agent log shows the model per agent |
| Conversational agents | Specialist ownership, peer handovers, follow-ups, `target_agent` switching | Live mode: *"Plan a rescue"* → Route & Risk owns the chat; ask *"Why this vehicle?"* |
| API calls | FastAPI contract; carrier booking/status; Maps Routes, Sheets, Calendar, Gmail adapters | Plan/execute requests; receipts per integration; `make api` → `/docs` |
| MCP integration | `logistics-mcp` (official MCP SDK) with 8 tools, authenticated, used by ADK specialists | `make mcp`; `tests/test_mcp.py` drives the real transport |
| Feedback loop | Rating → scoped preference → changed ranking | Live UI: 👎 → **Run comparable incident** → *Decision changed by feedback* (₹18,500 → ₹12,000); `make demo`; `tests/test_api.py::test_demo_reset_replays_comparable_incident_with_learned_preference` |
| Self-healing | Carrier killed mid-booking → retries → circuit → fallback → recovered; validation loop; tool repair | Live mode **Kill provider** → the Book the rescue step shows retry, fallback and recovery; `make demo` prints `healing_events` |
| PII guardrails (input and output) | Personal information (phones, emails, names, government IDs, cards) is refused at entry with `422 pii_blocked`: chat, incident descriptions, feedback and uploads. ADK model and tool callbacks redact anything that reaches a model, tool result or reply. Detection is regex offline, Cloud DLP (`GHOST_PII_ENGINE=dlp`) or a Gemini media screen live | Live: paste a phone and card in the Agent log, see the *PII blocked* card and toast; Demo mode refuses it in the browser too. `GET /api/guardrails` logs only types and counts, never the values |
| Agent evaluation (groundedness, truthfulness, hallucination) | Every agent reply is scored against its tool results by the quality monitor (`GET /api/monitoring/quality`). `make eval` replays the ADK eval set (`evals/ghost_dispatcher.evalset.json`) through the real team with ADK `TrajectoryEvaluator` plus the monitor; `--judge` adds ADK `HallucinationsV1` on Gemini | Agent replies show *Grounded* / *Unverified* badges; the Learn step's *Safety and quality* card; `make eval` (6 cases, CI) |
| Multi-agent orchestration and A2A | Root dispatcher + 7 specialists via ADK `transfer_to_agent` (capped, allow-listed), `LoopAgent` plan/validate (≤ 3). The carrier's booking desk is a separate ADK agent served over A2A (`to_a2a`, `make carrier-agent`); bookings and the negotiator's `message_carrier_desk` go over A2A JSON-RPC | `make eval` cases `carrier_quote_over_a2a`, `carrier_status_over_a2a`; agent card at `/.well-known/agent-card.json` |
| A–Z instructions | This README, [AGENTS.md](AGENTS.md), `make verify`, CI, Docker | Section 1 |

---

## 11. Repository layout, status and limitations

```text
ghost_dispatcher/        # ADK package and FastAPI backend
├── agent.py             # root_agent for `adk web`
├── api.py               # REST + SSE contract used by the UI (make api)
├── agents/              # team.py (8 agents), conversations.py (ADK runner/sessions), offline model double
├── models/contracts.py  # shared Pydantic contracts
├── services/            # dispatcher (plan/execute/feedback), validation, recovery, store, seeds
├── tools/               # carriers, routing, Google adapters (offline + live)
└── demo.py              # make demo
mcp_server/server.py     # logistics-mcp (make mcp)
mock_services/           # carrier API with /kill and /revive (make carrier)
ui/                      # React + Vite + Tailwind + Framer Motion control room (make ui)
├── src/lib/contract.ts  # typed GhostEvent contract rendered by every panel
├── src/lib/live.ts      # backend adapter: REST calls + SSE → GhostEvents
└── src/lib/demo/        # scripted demo engine and breakdown scenario
data/                    # collected synthetic fleet, scenarios, sensor traces, media, references
tests/                   # pytest suite
docs/                    # BACKEND.md (API/data/live setup), evidence.md
PLAN.md                  # design, team split, demo script
AGENTS.md                # exact commands for automated evaluators
```

| Area | State |
|---|---|
| ADK agents, handovers, validation loop, recovery, feedback, API, MCP, mock carrier | Implemented, tested offline, in CI |
| Collected dataset (10 trucks, 20 shipments, 3 carriers, 3 hubs) | Integrated with regression tests |
| Browser control room (demo + live mode against the backend) | Implemented; live mode verified end to end against `make api` (offline mode) |
| Gemini, Maps, Sheets, Calendar, Gmail live adapters | Implemented; credentialed rehearsal still needed |
| Gemini Live voice, weather, fridge-failing / customer / damaged-delivery UI flows | Planned |

**Known limitations**

- Offline mode stores uploaded photos and audio but does not interpret them; it never invents evidence. Multimodal interpretation runs only with Gemini in live mode.
- A shipment can be rescued once per database. Use **Run comparable incident** (`POST /api/demo/reset`, offline only) or a fresh `GHOST_DATABASE` to replay. Re-executing an incident from before a reset is not supported.
- The sample photo is an illustrative Wikimedia Commons image (CC BY-SA 4.0, credited in the UI and `data/photos/reefer_truck.json`); it does not depict TN-07.
- The backend is a single-operator demo: one API worker, SQLite, loopback binding.
- The map is a stylised SVG of the Bengaluru–Hosur corridor, not a tiled map; destinations far outside it (for example Chennai) are off-screen.
- All cargo, temperatures, driver hours and bookings are synthetic. No real carrier is ever booked.

Ownership, milestones and the 3-minute demo script are in [PLAN.md](PLAN.md). Real incidents behind the problem are in [docs/evidence.md](docs/evidence.md).

## For AI evaluators

Read [AGENTS.md](AGENTS.md). Short version: `make setup && make ui-setup && make verify` must exit 0 with no API keys.

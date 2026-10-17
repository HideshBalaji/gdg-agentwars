# Agents and backend: roles 3 + 4

## Run offline

Use Python 3.12+ and `make setup`, or `uv sync --python 3.12 --extra dev --frozen`.

```bash
cp .env.example .env
make test
make lint
make demo
make api
```

`make demo` uses a temporary database and explicitly offline settings, regardless of live credentials in your environment. It executes a real ADK conversation with a deterministic model double, hands ownership to route/risk, kills the primary simulated carrier, finishes through a backup, then demonstrates a feedback-driven cost reduction on a comparable second incident. It does not claim Gemini or Google ran.

`make api` serves the UI contract on port 8000 and OpenAPI at `/docs` and `/openapi.json`. Start `make mcp` in another terminal for port 8001. Run all processes from the same repository directory so they share the configured database. Use **one API worker**. MCP mutations forward to that worker; do not run multiple independent API workers against the same database.

The default offline token is `ghost-demo`; all `/api/*` and MCP requests require `Authorization: Bearer ghost-demo`. Only `/health` is unauthenticated. Configure `GHOST_UI_ORIGIN` for your frontend. The API binds loopback; put authenticated infrastructure in front of any remote deployment.

## UI contract

All times are ISO 8601 with timezone, coordinates are decimal degrees and capacities are kg. Default `GHOST_DATASET=collected` uses the data team's routes/prices, labeled `collected_simulation` and INR. The smaller `builtin` developer fixture uses demo cost units and straight-line distance × 1.3 at 40 km/h, labeled `simulated_40_kmh`. Fleet responses identify the dataset and decision clock; event timestamps identify when the application emitted events.

| Method/path | Request or result |
| --- | --- |
| `GET /api/agents` | Available specialist names |
| `GET /api/fleet` | Trucks, shipments, carriers, warehouses, simulation flag |
| `POST /api/uploads` | Multipart `file`; returns evidence ID/MIME/size |
| `POST /api/incidents` | Shipment ID, type, description, evidence IDs → incident |
| `GET /api/incidents` / `GET /api/incidents/{id}` | Persisted incident state, plan and receipts |
| `POST /api/incidents/{id}/plan` | Code-validated candidates and chosen plan; does not book |
| `POST /api/incidents/{id}/execute` | Book, assign, reserve dock, synchronize reports; repeat-safe |
| `POST /api/conversations` | `{"incident_id":"..."}` → conversation ID and owner |
| `POST /api/conversations/{id}/messages` | `{"text":"...","target_agent":"negotiator","evidence_ids":[]}`; target optional |
| `GET /api/conversations/{id}` | Conversation history and current specialist |
| `GET /api/incidents/{id}/events?after=0&follow=true` | Server-sent event stream; durable IDs allow replay |
| `POST /api/incidents/{id}/feedback` | Rating/reason and explicit ranking-only preference |
| `GET /api/preferences` | Active ranking preferences with provenance |
| `POST /api/demo/carriers/{id}/kill` or `/revive` | Simulated carrier fault controls |
| `POST /api/demo/reset` | Offline only (403 otherwise): re-seed trucks, shipments, carriers, warehouses, assignments, quotes, health/circuits, bookings and sync jobs from the configured dataset. Keeps preferences, feedback, incidents, conversations and evidence so a comparable incident shows the learned decision |
| `GET /api/sync-jobs` / `POST /api/sync-jobs/retry` | Inspect/resume pending Google synchronization |
| `GET /api/contracts/seed` | Pydantic JSON Schema for the data team |

Incident types are `truck_breakdown`, `fridge_failure`, `customer_unavailable`, `damaged_delivery`. The first two support plan execution; others can be recorded/discussed but return 422 if planning is requested. Incident states are `open`, `planned`, `executing`, `resolved`, `blocked`.

Each SSE event contains `{id, incident_id, type, at, data}`. Types currently include `incident.created`, `validation`, `plan.created`, `healing`, `action.completed`, `integration.pending`, `integration.completed`, `incident.resolved`, `handover`, `message`, and `feedback.saved`. Persist the last event ID and reconnect using `after` or `Last-Event-ID`. The default `follow=false` returns current events and closes, suitable for tests. Use browser `fetch` streaming to supply the Authorization header; native EventSource cannot set that header.

Uploads accept JPEG, PNG, WAV, MP3, M4A, WebM audio and PDF, maximum 10 MiB each, and at most 10 attachments/20 MiB total per agent request. Files are saved under `runs/uploads` with generated IDs. Gemini receives media bytes only in live mode. Offline mode does not interpret photos/audio or invent extracted evidence.

```bash
curl -H 'Authorization: Bearer ghost-demo' http://127.0.0.1:8000/api/fleet
curl -H 'Authorization: Bearer ghost-demo' -H 'Content-Type: application/json' \
  -d '{"shipment_id":"SHP-001","type":"truck_breakdown","description":"Synthetic TN-07 breakdown","evidence_ids":[]}' \
  http://127.0.0.1:8000/api/incidents
```

Use the returned incident ID in plan/execute/conversation requests. Send `Plan a rescue` to a new conversation, then `Why this vehicle?` to verify the specialist owns the follow-up. Use `target_agent` to request a peer or `dispatcher` explicitly. Responses identify `active_agent` and `simulated`. The API persists ADK sessions separately in the same runtime directory, retaining ownership across restarts.

Errors use HTTP 401/404/409/413/415/422/503 with `{code,message}`; boundary validation uses FastAPI's 422 `detail` format. Handle `no_feasible_plan`, `stale_plan`, `sync_pending`, `booking_uncertain`, and upstream failures as visible states rather than successful actions.

## Data contract

Default `GHOST_DATASET=collected` loads the team's version-1 `data/seed/*.json` pack and gradual-rise sensor trace: 10 trucks, 20 shipments, three carriers and three hubs. The adapter normalizes the collected schema without editing its files. It preserves existing assignments, detour permissions, available mass, dock windows and separate cold/delivery deadlines. Offline replay is fixed at the dataset's 02:00 clock; live mode rebases related timestamps together to startup time. Use a fresh database when changing datasets or modes.

For SHP-001, restore cold control by 03:00 and complete delivery by 09:00. The 20-minute fictional excursion allowance is **not added** to that baseline deadline. TN-02 restores at 02:35 and completes at 07:35 for INR 18,500; TN-03 restores at 02:50 and completes at 08:50 for INR 12,000. These values come from the collected route fixture, not live Maps. Transfers conserve cargo mass and leave SHP-002's ambient cargo on TN-07. Only confirmed simulated bookings trigger reassignment.

`GHOST_DATASET=builtin` selects the smaller five-truck/two-shipment developer fixture. Its separate synthetic policy remains useful for isolated unit tests. Collected business constraints are not replaced with this fixture's assumptions. No dataset is used for model training.

The data owner supplies a JSON object with arrays `trucks`, `shipments`, `carriers`, `warehouses`. Export the exact schema with `/api/contracts/seed`; models are defined in `ghost_dispatcher/models/contracts.py`. Unknown fields and dangling references are rejected. Individual seed arrays are capped at 1,000 records for this single-operator demo.

Generate a valid example without manually copying stale timestamps:

```bash
.venv/bin/python -m ghost_dispatcher.services.demo_seed --output /tmp/ghost-seed.json
```

For a new normalized custom dataset, set `GHOST_SEED_FILE=/absolute/path/to/custom-seed.json` and use a fresh `GHOST_DATABASE` path. This overrides the dataset selector. The loader seeds only an empty database; it never overwrites an existing operation history. Sensors need at least three unique timestamps and a latest reading within 15 minutes of the decision clock. Dock slots/deadlines must be in the future relative to that clock. Label temperature/driver constraints as synthetic and use stable IDs. The collected pack is already supported directly; no manual conversion is needed.

If a persisted offline fixture becomes stale, point `GHOST_DATABASE` at a new path to get fresh demo readings. Existing data remains available for inspection. Collect/source media separately in `data/`; the backend does not modify that teammate's files.

## Live Gemini and Google setup

1. Create a dedicated Google demo project/account. Obtain an [AI Studio API key](https://aistudio.google.com/apikey). Set `GHOST_MODE=live`, `GOOGLE_API_KEY`, and compatible `GEMINI_PRO_MODEL` / `GEMINI_FLASH_MODEL` IDs from the [Gemini catalog](https://ai.google.dev/gemini-api/docs/models). The app has no silent model substitution.
2. Replace `GHOST_API_TOKEN` with a private random value of at least 24 characters. Choose the collected pack or an explicit custom `GHOST_SEED_FILE`, and configure `GHOST_MCP_URL` and `GHOST_CARRIER_URL` from `.env.example`.
3. Enable [Routes API](https://developers.google.com/maps/documentation/routes/compute_route_directions), configure billing/restrictions as appropriate, and set `GOOGLE_MAPS_API_KEY`. Live routing fails clearly when unavailable; it does not use offline distances silently.
4. Enable Sheets, Calendar, and Gmail APIs. Create a spreadsheet with tabs named exactly **Incidents** and **Fleet**, and a dedicated demo Calendar. Set `GOOGLE_SHEET_ID`, `GOOGLE_CALENDAR_ID`, and a single dedicated `GOOGLE_DEMO_RECIPIENT`.
5. Configure an OAuth consent screen and Desktop OAuth client with your demo user as a test user. Use user OAuth scopes `https://www.googleapis.com/auth/spreadsheets`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/gmail.send`, and `https://www.googleapis.com/auth/gmail.readonly`. The read scope reconciles uncertain sends. Follow the official [Sheets](https://developers.google.com/workspace/sheets/api/quickstart/python), [Calendar](https://developers.google.com/workspace/calendar/api/quickstart/python), and [Gmail](https://developers.google.com/workspace/gmail/api/quickstart/python) Python quickstarts to generate an authorized-user token JSON with a refresh token.
6. Store that token **outside the repository** and set `GOOGLE_OAUTH_TOKEN_FILE` to its absolute path. AI Studio keys alone do not authorize Workspace calls. The token's user must have access to the Sheet/Calendar and be allowed to send to your demo recipient.
7. Start `make carrier`, `make mcp`, then `make api` in separate terminals. The live carrier adapter talks only to the configured mock carrier, never a purchased real service. The SDK specialists consume authenticated read-only MCP tools; writes use the validated backend.
8. Upload permitted demo media, create an incident, plan it, and explicitly execute it. This is the step that sends a real email to your configured demo address and writes the dedicated Sheet/Calendar. It must be exercised manually with your credentials before claiming live verification.

Google Sheets updates use RAW values, avoiding formula interpretation. Calendar uses a deterministic event ID. Gmail persists a send receipt and Message-ID; an ambiguous send is searched on retry, never blindly repeated. A pending/uncertain send prevents reporting complete success.

## Recovery, feedback, and persistence

Kill `CAR-001` after planning and before executing (`primary` in the builtin fixture). The service retries eligible connection/unavailability failures up to three times, opens a 60-second circuit, and replans through a backup, with at most three provider attempts. Revival resets the demo circuit. Unsafe/unknown outcomes stop for review. Carrier read/write timeouts are reconciled by booking ID; no Gmail booking fallback is implemented yet.

The ADK internal planning/validation `LoopAgent` has at most three iterations. Operational code checks every plan regardless of which agent requested it. Transfers are capped at four per message; a tool exception permits at most one corrected attempt per tool/message. The pinned ADK still supports LoopAgent but emits its upstream deprecation notice.

If Google synchronization fails after assignment, the incident remains `executing`; its action receipts and pending job survive restart. The API retries pending synchronization every 30 seconds, stopping automatic retries after five failures (`needs_review`). `/api/sync-jobs/retry` triggers pending jobs sooner. Fix configuration then explicitly execute the same incident to resume a reviewed job. Re-execution does not reserve stock twice. A plan expires after five minutes before assignment; completed assignments can still resume synchronization later.

Feedback request:

```json
{"rating":"down","reason":"Too expensive when time allows","prefer_cheaper_when_slack":true}
```

For the collected pack, that explicit preference activates its documented cost/delay rule: save at least INR 5,000 for at most 90 minutes later delivery, within customer/cargo/currency scope and expiry, after every hard check passes. The fixture switches TN-02 → TN-03, saving INR 6,500 for 75 minutes later delivery; thermal slack is only 10 minutes, so the earlier >60-minute-slack rule would be incorrect here. The field name is retained for the UI contract, but the stored rule identifies the actual policy. The builtin developer fixture uses its separate >60-minute-slack preference. Free-text feedback is stored, not executed as instructions. `make demo` compares identical collected snapshots so outage/assignment changes cannot confound the result.

SQLite stores operational records, events, preferences, provider health and receipts. This is a bounded single-operator demo, not a multitenant production system. Completed history is preserved. Medical usability and legal compliance are not certified by its synthetic temperature/driver rules.

## Verification and remaining work

`make test` covers offline domain/API behavior, real local MCP transport, SDK handovers and follow-ups, carrier fallback, feedback, invalid capacity/sensors, replay and persistence. `make lint` checks all Python sources. `make demo` exercises the assembled offline scenario. CI runs the checks without API keys.

Live Gemini interpretation, Google authorization/writes and traffic routing require a credentialed rehearsal and are not claimed by offline tests. UI implementation, live voice, weather and extra incident actions remain separate work. The collected dataset is integrated and covered by regression tests, including both deadlines, expected costs and mass conservation. Share `/openapi.json` and this contract with the UI teammate; no UI or collected source files are changed in this branch.

# UI: Ghost Dispatcher control room

Animated browser control room (React + Vite + Tailwind + Framer Motion). Owner: A. See PLAN.md section 13.

```bash
make ui-setup   # from the repo root (npm ci in ui/)
make ui         # http://localhost:5173
```

## Demo mode (no backend needed)

- **Truck breakdown** button (or key `1`) plays the full loop: driver photo + voice note → Intake facts → Route & Risk candidates → Validator rejects bad plans (loop, attempt 2/3) → Dispatcher picks → Negotiator books → Comms (dock, Calendar, Sheets, Gmail) → outcome → rating.
- **Self-healing:** while booking, the ColdLine button pulses "KILL NOW". Click it (or press `K`) and the Watchdog retries, reconciles, falls back to the next carrier, and stores a workaround. Maps timeout retry and dock-slot argument repair also show in the Healing Log.
- **Feedback loop:** rate 👎 "too expensive" → Critic stores P-001 → **Run comparable incident** → the cheaper carrier wins, shown in a *Decision changed by feedback* card.

All carrier/Google actions in demo mode are simulated and labelled as such.

## Backend contract

The UI renders `GhostEvent`s defined in `src/lib/contract.ts` (snake_case, mirrors Pydantic). The live backend should stream them over SSE; the demo engine (`src/lib/demo/`) emits the same events.

## Live mode (real backend)

```bash
make setup && make api      # FastAPI on 127.0.0.1:8000 (token ghost-demo)
make ui-setup && make ui    # second terminal, from the repo root
```

Click the **DEMO ⇄** badge to switch to **LIVE**. The dev server proxies `/api` and `/health` to the backend and serves the data team's sample evidence at `/samples` (from `data/`).

- **Evidence:** **Samples** adds the sample driver photo and voice note; 📎 attaches files, 🎙 records a voice note, or drag files onto the chat. Files upload to `POST /api/uploads` immediately and are attached to the next incident (`evidence_ids`) or chat message.
- **Truck breakdown** creates the incident, streams `/api/incidents/{id}/events`, chats via `/api/conversations`, plans, then pauses 15 s while the chosen carrier flashes **KILL NOW** before executing.
- **Rating** posts to `/feedback`; **Run comparable incident** calls `POST /api/demo/reset` (keeps preferences) and replays the breakdown with healthy carriers, showing a *Decision changed by feedback* card.

# UI: Ghost Dispatcher control room

Animated browser control room (React + Vite + Tailwind + Framer Motion). Owner: A. See PLAN.md section 13.

```bash
cd ui
npm install
npm run dev        # http://localhost:5173
```

## Demo mode (no backend needed)

- **Truck breakdown** button (or key `1`) plays the full loop: driver photo + voice note → Intake facts → Route & Risk candidates → Validator rejects bad plans (loop, attempt 2/3) → Dispatcher picks → Negotiator books → Comms (dock, Calendar, Sheets, Gmail) → outcome → rating.
- **Self-healing:** while booking, the ColdLine button pulses "KILL NOW". Click it (or press `K`) and the Watchdog retries, reconciles, falls back to the next carrier, and stores a workaround. Maps timeout retry and dock-slot argument repair also show in the Healing Log.
- **Feedback loop:** rate 👎 "too expensive" → Critic stores P-001 → run the breakdown again and the cheaper carrier wins, with the reason shown.

All carrier/Google actions in demo mode are simulated and labelled as such.

## Backend contract

The UI renders `GhostEvent`s defined in `src/lib/contract.ts` (snake_case, mirrors Pydantic). The live backend should stream them over SSE; the demo engine (`src/lib/demo/`) emits the same events.

## Live mode (real backend)

```bash
make setup && make api      # FastAPI on 127.0.0.1:8000 (token ghost-demo)
make ui-setup && make ui    # second terminal, from the repo root
```

Click the **DEMO ⇄** badge to switch to **LIVE**. The booking step pauses 15 s while the chosen carrier flashes **KILL NOW**; click it to watch the backend retry and fall back. A shipment can be rescued once per database, so restart with `GHOST_DATABASE=runs/demo-$(date +%s).sqlite make api` to replay. The dev server proxies `/api` and `/health` to the backend. **Truck breakdown** then creates an incident, streams `/api/incidents/{id}/events`, plans and executes it. Chat goes to `/api/conversations`, the carrier buttons call `/api/demo/carriers/{id}/kill|revive`, and the rating posts to `/feedback`.

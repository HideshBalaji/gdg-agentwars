# UI: Ghost Dispatcher control room

Browser control room (React, Vite, TypeScript, Tailwind, Framer Motion, MapLibre). Owner: A. See PLAN.md section 13.

```bash
make ui-setup   # from the repo root (npm ci in ui/)
make ui         # http://localhost:5173
```

## How the screen is organised

One question drives the layout: *what is happening right now, and what already happened?*

- **Start screen** (`components/Story.tsx` → `StartScreen`): attach evidence, simulate a breakdown, then watch and rate.
- **Now banner** (`NowBanner`): one plain-language sentence for the current moment, the acting agent and tool, *Step n of 7*, and, during booking, the **Kill provider** callout.
- **Step list** (`StepList`): Detect → Understand → Find options → Check and choose → Book the rescue → Notify → Learn. The live step is expanded with only its content; finished steps collapse to one-line summaries.
- **Metrics + map** (`Metrics.tsx`, `MapView.tsx`): rescue window, cargo temperature, plan and self-healing; MapLibre with CARTO basemaps, falling back to `SchematicMap.tsx` offline.
- **Agent log drawer** (`LogDrawer.tsx`, key `L`): the full timeline (`Activity.tsx`) with tool calls, recovery and receipts, the chat composer, plus Fleet and Memory tabs.
- **Top bar** (`TopBar.tsx`): Demo/Live toggle, Systems menu (health + carrier kill switches), agent log, ⌘K command menu, theme, Run comparable, Simulate breakdown.

Design tokens (light and dark) live in `src/index.css`; components use the Tailwind colour names `bg`, `surface`, `line`, `fg`, `accent`, `green`, `amber`, `red`, `violet`.

## Demo mode (no backend needed)

- **Simulate breakdown** (or key `1`) plays the full loop: driver photo + voice note → Intake facts → Route & Risk options → Validator rejects bad plans (re-plan, attempt 2/3) → Dispatcher picks → Negotiator books → Comms (dock, Calendar, Sheets, Gmail) → outcome → rating. Evidence attached on the start screen replaces the built-in sample.
- **Self-healing:** during the booking pause the Now banner shows **Kill provider** (or press `K`); the Watchdog retries, reconciles, falls back to the next carrier and stores a workaround.
- **Feedback loop:** rate 👎 "too expensive" → Critic stores P-001 → **Run comparable incident** (`C`) → the cheaper carrier wins, shown in the banner and a *Decision changed by feedback* card.

All carrier and Google actions in demo mode are simulated and labelled as such.

## Live mode (real backend)

```bash
make setup && make api      # FastAPI on 127.0.0.1:8000 (token ghost-demo)
make ui-setup && make ui    # second terminal, from the repo root
```

Switch the top-bar toggle to **Live**. The dev server proxies `/api` and `/health` to the backend and serves the data team's sample evidence at `/samples` (from `data/`).

- **Evidence:** **Use sample evidence**, **Attach files** or **Record voice note** on the start screen (or the agent log's composer). Files upload to `POST /api/uploads` immediately and are attached to the next incident (`evidence_ids`) or chat message.
- **Simulate breakdown** creates the incident, streams `/api/incidents/{id}/events`, chats via `/api/conversations`, plans, then pauses 15 s with **Kill provider** before executing. A shipment already rescued in the current database is re-seeded first via `POST /api/demo/reset`.
- **Rating** posts to `/feedback`; **Run comparable incident** calls `POST /api/demo/reset` (keeps preferences) and replays the breakdown with healthy carriers.

## Backend contract

The UI renders `GhostEvent`s defined in `src/lib/contract.ts` (snake_case, mirrors Pydantic). The demo engine (`src/lib/demo/`) emits them directly; `src/lib/live.ts` maps the backend's SSE events onto them.

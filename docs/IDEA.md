# Ghost Dispatcher

> *When a vaccine truck breaks down at 2 AM, Ghost Dispatcher saves the cargo before a human even wakes up — and fixes itself if its own tools fail.*

A self-healing, multi-agent control room for **cold-chain logistics**. When something goes wrong during a delivery, it detects the problem, understands it from photos, voice and sensor data, re-plans, acts (books, reroutes, negotiates), notifies everyone, and learns from the outcome.

---

## 1. Hackathon context: Agent Wars

**Problem statement:** Logistics Handler

**Required tools:** Agent SDK (Google ADK) + Google products

**Judging criteria**
- No half-baked work: complete A–Z instructions
- Multi-model / multimodal agents and conversational agents
- API calls
- MCP integration
- A working feedback loop
- Self-healing agents

**Submission**
- Public GitHub repo with a detailed README covering how the agent works end to end and how to run it
- Submit via the form. Entries are judged **first come, first served**, so submit early.
- Team size: minimum 2, maximum 4

**Links**
- Registration: https://forms.gle/z8TdF1V4yq3mfESN8
- Submission: https://forms.gle/dZZ1BLH8vDAKr5wJ9

---

## 2. The problem

Logistics doesn't fall apart on normal days. It falls apart when something goes wrong. A human dispatcher then spends hours on phone calls and emails: finding a replacement truck, rebooking dock slots, chasing carriers, updating customers.

In a **cold chain** (vaccines, insulin, food), every minute counts. If a refrigerated truck fails, the cargo has a fixed window before it spoils. Slow human firefighting means destroyed cargo, lost money and, for medicines, patients who don't get their doses.

### Real-world evidence (use on the problem slide)

Screenshot the headline or post from each link for your slides rather than retyping it. Each case below is summarized in our own words.

**Real incidents (news)**

| # | What happened | Why it matters for us | Source |
|---|---|---|---|
| 1 | **Mendocino County, California, Jan 2021.** A hospital freezer's compressor failed around **2 a.m.**, putting **830** COVID vaccine doses at risk. Staff had about **two hours** to use them and scrambled in the middle of the night to find people to vaccinate. | Almost exactly our pitch: a 2 AM failure, a hard spoilage deadline, and humans scrambling by phone. *(A storage freezer, not a truck. Say that honestly.)* | [NPR via KISU, 5 Jan 2021](https://www.kisu.org/npr-coronavirus-updates/2021-01-05/hospital-scrambles-to-find-patients-before-freezer-failure-ruins-830-vaccines) |
| 2 | **Maine, Jan 2021.** **4,400** Moderna doses heading to **35** sites went out of the required temperature range **in transit**. Temperature monitors on the boxes flagged it, the doses were set aside, and replacements had to be shipped. | A transit failure detected by sensors, followed by manual re-planning and reshipping. That's exactly what Ghost Dispatcher automates. | [Boston Globe, 20 Jan 2021](https://www.bostonglobe.com/2021/01/20/business/glitches-hamper-rollout-modernas-vaccine), [FOX 13, 4 Mar 2021](https://www.fox13news.com/news/thousands-of-covid-19-vaccine-doses-lost-to-spoilage-or-discarded-across-us) |
| 3 | **Michigan, Jan 2021.** **21** McKesson shipments (the Globe puts it at almost **12,000** doses) arrived too cold because of faulty gel packs. Replacement shipments went out over the next two days, and six more shipments were held back for checks, delaying vaccinations. | A multi-site incident: re-planning 21 deliveries at once. *(Caveat: Moderna later said many of these doses were still usable under specific storage conditions.)* | [WXYZ Detroit](https://www.wxyz.com/news/coronavirus/21-shipments-of-the-moderna-vaccine-to-michigan-are-no-longer-useable-due-to-transport-error), [FOX 17 follow-up](https://fox17online.com/news/coronavirus-vaccine/moderna-vaccine-doses-that-went-out-of-temperature-range-still-viable) |
| 4 | **Boston VA hospital, Jan 2021.** Nearly **2,000** doses spoiled after a contractor accidentally unplugged a freezer. | Nobody noticed in time. Continuous monitoring plus automatic response would have. | [FOX 13 roundup (AP)](https://www.fox13news.com/news/thousands-of-covid-19-vaccine-doses-lost-to-spoilage-or-discarded-across-us) |

**Industry numbers**

| Stat | Source | Caveat |
|---|---|---|
| Biopharma loses about **$35 billion a year** from failures in temperature-controlled logistics | IQVIA Institute, first shared in the 2019 Biopharma Cold Chain Logistics Survey ([cited by SkyCell, 2024](https://blog.skycell.ch/blog/skycell-assessed-for-less-than-0.05-temperature-excursion-rate)) | A 2019 figure that is still widely quoted. Say "estimated". |
| In the same survey, **44.6%** of respondents reported multiple temperature excursions per year | 2019 Peli BioThermal / IQVIA survey (via industry coverage) | Same survey, so the same age |
| The WHO estimates **up to 50% of vaccines** are wasted globally, with temperature control and cold-chain logistics among the main causes | [UNEP story](https://www.unep.org/news-and-stories/story/why-optimized-cold-chains-could-save-billion-covid-vaccines) and other outlets citing the WHO | Second-hand citation. Wording varies between sources. |
| India loses about **₹1.53 lakh crore a year** of food post-harvest (≈2.35% of GDP) | NABCONS 2022 study for MoFPI ([Dataful summary](https://insights.dataful.in/articles/from-guava-to-milk-what-food-loss-reveals-about-indias-supply-chains)) | Covers all post-harvest loss, not only cold-chain failures |

**Voices from people in the industry (forums)**

Real driver and dispatcher discussions on TruckersReport, the largest US trucking forum. *We couldn't open these pages (they're behind a bot check), so open them in your own browser, find the strongest post, and screenshot it.*

- [*"What happens if your reefer breaks down while you're loaded?"*](https://www.thetruckersreport.com/truckingindustryforum/threads/what-happens-if-your-reefer-breaks-down-while-youre-loaded.246340/): drivers explain that the temperature log decides who pays the claim, and that insurers can refuse to pay if the driver doesn't get to the nearest repair dealer or call after-hours service right away. **Takeaway:** the response has to start immediately, at any hour.
- [*"Reefer Produce Claim"*](https://www.thetruckersreport.com/truckingindustryforum/threads/reefer-produce-claim.1771440/) and [*"Reefer load claims"*](https://www.thetruckersreport.com/truckingindustryforum/threads/reefer-load-claims.1579935/): spoiled or rejected loads and the fight over who pays.
- [*"Dispatcher horror stories"*](https://www.thetruckersreport.com/truckingindustryforum/threads/dispatcher-horror-stories-lets-hear-em.178043/): dispatch threads on the forum describe the job as very stressful with high turnover and midnight calls, with one person handling **30–50 drivers** at large carriers.

**Reddit** (also couldn't be opened from here). Search these yourself and screenshot the best posts:
- r/Truckers: `reefer broke down loaded`, `load rejected temp`
- r/FreightBrokers: `recovery truck breakdown` (brokers scrambling for a replacement truck at night)
- r/logistics: `dispatcher burnout`, `cold chain excursion`

**Suggested problem slide:** the NPR "2 a.m." headline on the left, and the $35B and WHO 50% stats on the right. Then: *"Today, humans handle this by phone in the middle of the night. Ghost Dispatcher handles it in seconds."*

## 3. The solution

Ghost Dispatcher is a team of AI agents that handles delivery incidents end to end. Every incident runs through the same loop:

```
detect → understand → re-plan → act → notify → learn
```

The agents don't change between incidents; only the situation does. That's what makes it a general system rather than a single hard-coded script.

---

## 4. Incidents it handles

### Primary (build deeply; this is the main demo)
| Incident | Detected from | Response |
|---|---|---|
| **Truck breakdown** | Driver's photo + voice note | Calculates the spoilage deadline, finds the nearest reefer truck with capacity, reassigns the load, rebooks the dock slot, notifies the customer |

### Extras (cheap to add; they reuse the same agents)
| Incident | Detected from | Response |
|---|---|---|
| **Fridge failing** (truck moving, temperature rising) | Temperature sensor feed | Estimates minutes until spoilage, reroutes to the nearest cold-storage hub or transfers the load |
| **Customer not available** | Customer chat reply | Reschedules through conversation, re-plans the route |
| **Damaged delivery** | Photo from driver or customer | Assesses the damage, triggers a replacement shipment, logs the claim |

### Future / stretch (mention in the pitch, don't build)
- Traffic jam / road closure / flood → reroute within the safe window
- Missed dock slot → rebook and notify the receiver
- Driver hit legal driving hours → find a relief driver
- Carrier no-show → book a backup carrier
- Missing or wrong documents at a checkpoint → read the photo, draft corrected docs

---

## 5. Agent architecture (Google ADK, Python)

```
dispatcher (orchestrator)
├── intake       – photos, voice notes, PDFs, sensor data → structured Incident
├── route_risk   – Maps routes, traffic, weather, spoilage math → candidate plans
├── negotiator   – conversational/voice with carriers and customers
├── comms        – Gmail, Calendar, Sheets updates
├── validator    – checks the plan is physically and legally valid
├── watchdog     – catches tool failures → retry / fallback / repair
└── critic       – turns ratings and outcomes into learned preferences
```

| Agent | Model | Responsibilities |
|---|---|---|
| **dispatcher** | Gemini Pro | Receives the incident, delegates to sub-agents, picks the final plan, applies learned preferences |
| **intake** | Gemini Flash | Multimodal parsing: damage photos, voice notes, delivery slips, sensor readings → `Incident` object |
| **route_risk** | Gemini Flash | Calls Maps Routes and weather, computes arrival time vs spoilage deadline, ranks options by cost / risk / time |
| **negotiator** | Gemini Live (voice) / Flash (chat) | Books backup carriers, reschedules with customers |
| **comms** | Gemini Flash | Sends emails, books Calendar slots, updates the Sheet fleet board |
| **validator** | Gemini Flash + plain code checks | Truck has a reefer unit? Enough capacity? Arrival before spoilage? Driver hours OK? |
| **watchdog** | Code + Gemini Flash | Handles tool errors (see §7) |
| **critic** | Gemini Flash | Stores ratings and outcomes, writes preference rules (see §8) |

> Gemini model IDs change often. Check the current Pro / Flash / Live model names in the ADK docs during setup.

---

## 6. How this hits every judging criterion

| Criterion | Where it shows up |
|---|---|
| Multimodal / multiple models | Intake reads photos, voice and PDFs; Pro for planning, Flash for fast tasks, Live for voice |
| Conversational agent | Negotiator talks to carriers and customers; the driver chats with the system |
| API calls | Google Maps Routes and Places, weather, Gmail, Calendar, Sheets, mock carrier API |
| MCP integration | Custom `logistics-mcp` server exposing fleet, shipments, hubs, carriers |
| Feedback loop | Ratings → critic → memory → visibly different decision on the next incident |
| Self-healing | Watchdog recovers from a carrier API failure **live on stage**; validator loops bad plans back |
| A–Z instructions | README with setup, keys, one-command demo, architecture diagram, demo script |

---

## 7. Self-healing design

Healing happens at five levels, and every action is written to a visible **Healing Log**:

1. **Retry:** transient errors (timeouts, 5xx) → retry with backoff.
2. **Provider fallback:** carrier API down → backup carrier API → fall back to Gmail booking request.
3. **Plan validation loop:** the validator rejects an invalid plan (no reefer, misses the deadline) → the error goes back to the dispatcher to re-plan (`LoopAgent`, max 3 attempts).
4. **Tool-call repair:** a tool call fails on bad arguments → watchdog reads the error and retries with corrected arguments.
5. **Learned workaround:** "Carrier X API failed → used Y" is stored in memory, so the next incident skips the broken provider straight away.

Implementation hooks: ADK `after_tool_callback` / `before_tool_callback` to intercept tool results and errors, plus a `LoopAgent` for validate-and-retry. *(Check exact names in the current ADK docs.)*

**The demo moment:** the mock carrier has a `/kill` endpoint. Hit it mid-incident and the watchdog recovers on screen.

---

## 8. Feedback loop design

1. After each incident, the human dispatcher rates the decision (👍/👎 + a short reason), e.g. *"too expensive — prefer cheaper carrier when there's slack."*
2. The **critic** turns the rating into a preference rule, e.g. `IF spoilage_slack > 60 min THEN prefer lowest-cost carrier`.
3. Rules plus outcome metrics (cargo saved? arrival vs deadline? cost) are stored in Firestore (SQLite to start).
4. The dispatcher loads the learned preferences into its instructions for every new incident.
5. **Demo:** run incident #1 → rate it "too expensive" → run incident #2 → the agent picks the cheaper option and *says why*.

---

## 9. MCP server: `logistics-mcp` (FastMCP)

| Tool | Purpose |
|---|---|
| `get_shipment(shipment_id)` | Cargo, temperature range, deadline, destination |
| `list_trucks_near(lat, lng, radius_km, needs_reefer)` | Available trucks with capacity |
| `assign_load(shipment_id, truck_id)` | Reassign cargo |
| `get_temperature_history(truck_id)` | Sensor readings for spoilage math |
| `find_cold_hubs_near(lat, lng)` | Cold-storage hubs with free capacity |
| `book_dock_slot(warehouse_id, time)` | Reserve a dock |
| `list_carriers(region)` | Carriers with cost, reliability, API status |
| `log_incident(incident)` | Persist the incident, plan, actions, outcome |

Google APIs (Maps, Gmail, Calendar, Sheets) are wrapped as ADK tools or exposed through MCP. Use whichever is faster to build.

---

## 10. Data model (seed data)

- **Truck:** `id, reefer, capacity_kg, location, status, temp_c, driver_id, driver_hours_left`
- **Shipment:** `id, cargo, temp_min_c, temp_max_c, safe_minutes_out_of_range, origin, destination, deadline, value, priority`
- **ColdHub / Warehouse:** `id, location, free_capacity, dock_slots`
- **Carrier:** `id, name, api_url, cost_per_km, reliability, reefer_available`
- **Incident:** `id, type, inputs, status, plan, actions, healing_log, outcome, rating`

Seed: **10 trucks, 20 shipments, 3 warehouses / cold hubs, 3 carriers** (one with the kill switch), plus sample photos, voice notes and sensor traces in `data/`.

**Spoilage math (keep it simple):** take the last N temperature readings, fit a straight line, estimate minutes until `temp_max_c` is crossed, then add `safe_minutes_out_of_range`. That's the deadline every plan must beat.

---

## 11. Tech stack

- **Agents:** Google ADK (Python), `adk web` for the dev/demo UI (chat, voice, trace view)
- **Models:** Gemini via Google AI Studio (free-tier key; judges paste their own key from `.env.example`)
- **MCP:** FastMCP
- **Mock services:** FastAPI (carrier API with `/kill`, sensor feed simulator)
- **Google products:** Maps Routes and Places, Sheets (live fleet board), Calendar (dock slots), Gmail (notifications), Firestore (memory)
- **Deploy (optional):** Cloud Run
- **Coding assistants (Codex, Claude Code, etc.):** fine for *building* it; the runtime models are Gemini only

---

## 12. Repo layout

```
ghost-dispatcher/
├── agents/
│   ├── dispatcher.py
│   ├── intake.py
│   ├── route_risk.py
│   ├── negotiator.py
│   ├── comms.py
│   ├── validator.py
│   ├── watchdog.py
│   └── critic.py
├── mcp_server/          # logistics-mcp (FastMCP)
├── mock_services/
│   ├── carrier_api.py   # FastAPI with /kill and /revive
│   └── sensor_feed.py   # simulated fridge temperatures
├── data/                # seed JSON, sample photos, voice notes, sensor traces
├── memory/              # feedback + healing playbook store
├── scripts/
│   ├── seed.sh
│   └── demo.sh          # one-command demo
├── docs/architecture.png
├── .env.example
└── README.md            # A–Z instructions (required for submission)
```

---

## 13. Build plan

Assumes about 2 days and 3–4 people. Compress proportionally if you have less time.

| Phase | Time | Work | Owner |
|---|---|---|---|
| 0. Setup | 2h | Register team, repo, API keys, seed data | All |
| 1. Core loop | 8h | Photo in → Incident → new plan → Sheet updated. **Make this fully working first.** | A (agents), B (MCP + data) |
| 2. Comms | 4h | Gmail, Calendar dock rebooking, customer arrival-time message | B |
| 3. Self-healing | 6h | Mock carrier + kill switch, watchdog, validator loop, Healing Log | C |
| 4. Feedback loop | 4h | Rating → critic → memory → visibly different second decision | A |
| 5. Extras | 3h | Fridge-failing alert, customer reschedule, damaged-delivery photo | B / C |
| 6. Voice | 4h | Negotiator on Gemini Live in `adk web` (browser voice, not real phone calls) | D |
| 7. Ship | 4h | README, architecture diagram, demo script, recorded backup video, **submit** | All |

**Roles**
- **A, agents lead:** dispatcher, critic, prompts, orchestration
- **B, data and integrations:** MCP server, seed data, Google APIs
- **C, reliability:** watchdog, validator, mock services, Healing Log
- **D, voice, UI and docs:** negotiator voice, demo setup, README, video

**Cut order if time runs out:** voice → extras → comms polish. **Never cut:** core loop, self-healing, feedback loop, README.

---

## 14. Demo script (3 minutes)

**Screen setup:** `adk web` on the left, the live Google Sheet fleet board on the right.

0. **(before the demo) Real-world proof:** one slide with the Mendocino "2 a.m." freezer case and the $35B stat (see §2, *Real-world evidence*). "This really happens. Here's what it looks like with Ghost Dispatcher:"
1. **(0:00) Hook:** "It's 2 AM. Truck TN-07 is carrying vaccines to a hospital. The fridge has 4 hours before they spoil. And it just broke down near Hosur."
2. **(0:20) Intake:** the driver's photo + voice note arrive → the parsed incident appears on screen (damage, location, cargo, deadline).
3. **(0:50) Re-plan and act:** nearest reefer truck found, load reassigned, dock slot moved, customer notified → the Sheet updates live.
4. **(1:30) Break it:** hit `/kill` on the carrier API mid-booking → the Healing Log shows the failure, the fallback to the backup carrier, and the job finishing anyway.
5. **(2:10) Learn:** rate the decision "too expensive" → trigger a fridge-failing incident → the agent picks the cheaper option and explains why.
6. **(2:40) Close:** "Same loop, any incident. Ghost Dispatcher saves the cargo before a human even wakes up."
7. *(Optional)* A 20-second voice negotiation with the carrier.

**Always have a recorded backup video** in case Wi-Fi or an API fails during the live demo.

---

## 15. README checklist (submission requirement)

- [ ] What it is (pitch + problem)
- [ ] Architecture diagram + agent descriptions
- [ ] Prerequisites (Python version, Google Cloud project, APIs to enable)
- [ ] How to get each API key; `.env.example` explained line by line
- [ ] Install + seed data commands
- [ ] One-command run (`scripts/demo.sh`)
- [ ] How to trigger each incident type
- [ ] How to trigger the self-healing demo (`/kill`)
- [ ] How the feedback loop works + how to rate
- [ ] Judging criteria → feature mapping table (copy §6)
- [ ] Known limitations + future work
- [ ] Team members

---

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Voice (Gemini Live) is flaky | Build it last; the demo works without it |
| Google API quotas / auth issues on demo day | Mock fallbacks for each API; recorded backup video |
| Scope creep across many incidents | One deep incident + max 3 cheap extras |
| LLM picks an invalid plan | Code-based validator checks before any action |
| Late submission | Submit a working core version early, then update the repo |

## 17. Open questions for the team

- [ ] Does "Multi model Agents" mean multiple models or **multimodal**? Ask the organizers. (Covered either way.)
- [ ] Are non-Google models allowed? Assume **Gemini only** to be safe.
- [ ] Final team size and time available? Adjust §13.
- [ ] Real Google Sheets/Gmail accounts for the demo, or a dedicated demo Google account? (Prefer a dedicated one.)

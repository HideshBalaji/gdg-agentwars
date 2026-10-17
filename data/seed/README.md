# Ghost Dispatcher synthetic replay data

All seed records, traces, incident scripts, feedback, names, prices and timings are **synthetic**. This is a collected demonstration dataset, not an application or a record of actual agent runs. Fixed replay: **2026-10-17T02:00:00+05:30** (Asia/Kolkata). No credentials or real contacts: every tool/contact endpoint uses reserved `.invalid`; nothing calls these endpoints. Money is INR, distance km, mass kg, temperature Celsius. Coordinates identify an illustrative India corridor; routing durations/distances are invented, not map-service results.

## Files and links

Seed JSON uses `{schema_version, provenance, records}` except `mock_tools.json`, which has `tools` instead of `records`.

| File | Records and important fields |
|---|---|
| `trucks.json` | 10 trucks: `truck_id`, `carrier_id`, `driver_id`, location, `observed_at`, availability, reefer operating/range, total/assigned/remaining kg, duty hours, pricing minimum/base/per-km INR, detour permission |
| `drivers.json` | 10 fictional drivers: `driver_id`, `truck_id`, `.invalid` contact, availability, duty hours/window |
| `shipments.json` | 20 shipments: `shipment_id`, `customer_id`, `cargo_profile_id`, kg, temperature range, origin hub, destination/dock, independent cold-control and business deadlines, `declared_value` `{amount,currency}`, `priority`, `safe_minutes_out_of_range` |
| `assignments.json` | 20 current assignments: `assignment_id`, shipment/truck/driver links, assigned mass, active status, start/end timestamps |
| `customers.json` | 5 fictional receivers with location, receiving window and `.invalid` email |
| `carriers.json` | 3 fictional carriers; `.invalid` mock APIs and contact addresses; booking mode |
| `warehouses.json` | 3 fictional cold hubs: locations, 24h opening hours, capacity, cold ranges, handling times, dated dock slots |
| `cargo_profiles.json` | 3 explicitly invented cargo profiles, simulated ranges and excursion budgets |
| `rescue_options.json` | Seven precomputed alternatives: truck/shipment links, pickup/transfer/drive/delivery timing, duty, cost, expected validation/provider status |
| `mock_tools.json` | Strict mock argument/response descriptions for quote, reservation and Gmail-like email; not callable real tools |

Primary keys are deterministic strings. Every current shipment has **exactly one active assignment** and its mass contributes once to its truck's assigned kg; remaining kg equals total minus assigned kg. Driver/truck and carrier links match. Rescue options are proposals, not additional active assignments. Only after confirmed transfer would a consumer end `ASN-001` and replace it; the baseline expected transition conserves 600kg. `null` thermal deadlines mean no incident projection supplied, not unrestricted cargo safety. Existing non-incident assignments are loaded fleet snapshots, not guaranteed route schedules.

Every shipment has an invented INR declared value and a demo priority (`critical` for SHP-001, otherwise `routine`), not an appraisal or insured value. `safe_minutes_out_of_range` repeats its cargo profile's `simulated_excursion_budget_min`: 20 for inert vaccine training cargo, 30 for chilled training packs, and `null` for ambient cargo with no thermal constraint modeled. Despite the field name, this is only a fictional scoring allowance, **not a medical safety guarantee, product expiry, legal limit, or disposition rule**. Unknown exposure remains unknown and the baseline cold deadline is not extended by this allowance. `origin_hub_id` resolves origin coordinates through `warehouses.json`.

## Canonical incident and timing

`SHP-001` is 600kg of **inert fictional vaccine training cargo**, not a real vaccine shipment. It is loaded on broken `TN-07`, driver `DRV-007`, at Hosur (12.7409,77.8253), bound for fictional receiver `CUS-001` in Chennai (13.0827,80.2707). `SHP-002` is 400kg ambient training cargo on the same truck; rescuing SHP-001 does not silently transfer SHP-002.

Breakdown occurred01:45; decision clock02:00. The gradual simulated cargo probe reads6.5C, rising0.025C/min; `(8-6.5)/0.025=60min` to the invented upper boundary. Cold control must be restored by03:00; separate business receipt completion is due09:00. The 15 minutes since breakdown are **not** 15 minutes above range: known exposure is0. The invented20-minute excursion budget is not added to baseline headroom. No temperature, budget or time window is medical, legal or product-specific advice.

* Fast `TN-02`: pickup02:20, transfer15min, cold restored02:35; drive290min plus receive10min => completed07:35. Route340km; `max(10000,1500+50*340)=INR18500`. Required duty335min <450min available. Post-transfer load1100kg, remaining700kg.
* Cheaper `TN-03`: pickup02:35, transfer15min, cold restored02:50; drive350min plus receive10min => completed08:50. `max(8000,1800+30*340)=INR12000`. Required duty410min <480min available. Post-transfer load1400kg, remaining600kg.
* Both cold and delivery deadlines pass. Cheaper savesINR6500 and delays **delivery75 minutes**, a >60min preference demonstration; this is **not** >60min thermal slack. Its cold and delivery margins are each10min. Expected default prioritizes earliest cold restoration; explicit after-feedback policy permits up to90min delivery delay for at leastINR5000 savings without relaxing any hard constraint.
* Reject TN-04 no reefer, TN-05 only200kg remaining, TN-06 only30min duty, TN-09 arrival too late for cold control. TN-10 is physically feasible but its mock provider is unavailable in baseline/outage fixtures. TN-01 is committed without rescue detour, TN-08 under maintenance, TN-07 cannot rescue itself.

Dock `DOCK-CHENNAI-001` accepts this shipment07:00–09:00 including10min receiving; both valid completions fit. Roadside transfer is15min, not an extra trip to a cold hub. Other hubs are resource context, not unmodeled shortcuts. Delays outside the scripted rounded ETA require recomputing feasibility; don't assume unused slack is unlimited.

## Sensors, scenarios and feedback

`../sensors/` contains six independent31-row CSV traces (one-minute sampling) and `catalog.json`: stable, gradual rise, rapid rise, already out of range, recovery after transfer, missing/noisy. CSV columns: `truck_id,sensor_id,observed_at,temp_c,quality`. Measurement is a **simulated cargo probe**, not reefer air. Blank temperatures are missing, not zero; suspect samples remain raw but cannot justify safety claims. Catalog includes expected slope/exposure math. Rapid rise has5min known excursion already elapsed and15min of invented budget left; neither baseline rescue is timely. Already-out-of-range has at least30min known exposure with unknown earlier history. Missing trace has10min staleness and unknown current exposure. Post-transfer trace is a future hypothetical illustration; never leak future samples into02:00 decisions.

`../scenarios/` JSON fixtures contain synthetic inputs, `scripted_provider_results`, and **separate** `expected_outcomes`; `execution_status` is `not_executed`. Scenarios cover breakdown, bounded idempotent retry, outage/fallback, three hard validation rejections, argument repair, temporary provider workaround, Gmail-like pending booking, thermal variants, feedback comparison, and optional fridge/customer/damage inputs. A mock confirmed response is scripted, not evidence of an actual booking. Email accepted/sent never means booking confirmed. Ratings in `../feedback/` are invented before/after examples, not measured results. Rules have explicit scope, hard constraints, expiration/reconsideration conditions; provider failures are not permanent bans.

Media links are exactly `data/photos/reefer_truck.jpg` (external illustrative photo, **not failure evidence**), `data/audio/breakdown.wav` (generated synthetic voice input), and `data/documents/SHP-001_manifest.pdf` (generated training document). Their provenance is maintained by the owning data collectors. No other media paths are asserted.

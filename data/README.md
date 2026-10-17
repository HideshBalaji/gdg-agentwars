# Ghost Dispatcher data collection

A replayable, locally usable resource pack for the cold-chain logistics demo. **This is data, not an implemented dispatcher or evidence of a successful ADK run.**

## Start here

- Primary incident: [`scenarios/breakdown.json`](scenarios/breakdown.json).
- Linked operational tables and schema notes: [`seed/README.md`](seed/README.md).
- Temperature traces and mathematical expectations: [`sensors/catalog.json`](sensors/catalog.json).
- Controlled before/after feedback comparison: [`scenarios/feedback_comparison.json`](scenarios/feedback_comparison.json).
- Sources, setup resources, and externally supplied account prerequisites: [`references/README.md`](references/README.md).
- File inventory, classifications, sizes, and SHA-256: [`collection_manifest.json`](collection_manifest.json).
- Observed collection verification and limitations: [`validation_report.json`](validation_report.json).

All `data/...` paths are relative to the repository root. JSON Pointer references such as `breakdown.json#/incident` resolve relative to the containing file. Most operational JSON tables use `{schema_version, provenance, records}` rather than a bare array.

## Contents and provenance

| Folder | Contents | Classification |
| --- | --- | --- |
| `seed/` | 10 trucks, 20 shipments/assignments, 10 drivers, 5 customers, 3 hubs, 3 carriers, cargo profiles, rescue choices and mock tool contracts | Synthetic business records; approximate corridor geography |
| `sensors/` | Six CSV traces, 31 samples each; stable, rising, rapid rise, out-of-range, recovery, missing/noisy | Simulated cargo-probe data, not physical sensor measurements |
| `scenarios/` | Breakdown, retries, provider fallback, invalid plans, argument repair, email-pending booking, provider memory, feedback comparison and optional incidents | Authored inputs and expected outcomes; not actual agent outputs |
| `feedback/` | Comparable before/after cases, conditional cost preference, provider-healing examples | Synthetic ratings and memory; not empirical learning results |
| `photos/` | Three original licensed photos, one licensed roadside-breakdown thumbnail, and an explicitly synthetic temperature-display PNG | Public illustrative media plus generated OCR fixture; see attribution README |
| `audio/` | Four PCM WAV voice notes, transcripts and per-file annotations | Offline eSpeak NG synthetic speech; no real driver recordings |
| `documents/` | Manifest and unsigned/unreceived delivery slip, with structured annotations | Original synthetic, text-extractable PDFs |
| `references/` | Official source catalog, cold-chain material and integration/access guidance | Real published references, separately licensed |

Original synthetic business records, scenarios, annotations, documents, display drawing and audio fixture content are offered under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/). External photographs and publications retain their own licenses and restrictions; no blanket CC0 claim applies to them. Preserve the photo credits and applicable share-alike terms.

## Replay invariants

- Fixed demonstration clock: **2026-10-17 02:00:00 +05:30**, display timezone `Asia/Kolkata`. These are not current fleet observations. Rebase all related times together for a different demo date.
- Canonical incident: `INC-001`, shipment `SHP-001`, broken truck `TN-07`, driver `DRV-007`, 600 kg of **inert fictional vaccine training units** near Hosur.
- Projected **cold control must be restored by 03:00**. **Delivery must complete by 09:00**. Those deadlines are different constraints; restoring refrigeration does not require reaching Chennai by 03:00.
- The baseline linear projection uses 6.5 C at 02:00 and a 0.025 C/min rise toward the fictional 8 C upper boundary. It conservatively requires restoration before that boundary. Do not silently substitute the brief's alternative policy of adding an excursion allowance.
- Fast TN-02: cold restoration 02:35, delivery completion 07:35, INR 18,500. Cheaper TN-03: restoration 02:50, completion 08:50, INR 12,000. Route times and prices are invented fixtures, not live Maps/carrier quotes.
- The feedback rule explicitly accepts up to 90 minutes of later delivery to save at least INR 5,000 **only after every hard constraint passes**. In the paired cases, only preference memory changes. The expected cheaper decision saves INR 6,500 with a 75-minute delivery delay and 10-minute margins on both deadlines. It does not demonstrate more than 60 minutes of thermal slack.
- Quotes, email acknowledgments, booking confirmations, transfers and delivered cargo are different states. Expected outcomes do not establish that any occurred. Never mark an emailed booking request as a confirmed truck.
- `TN-07` also carries an ambient shipment. The modeled rescue transfers SHP-001 only; remaining ambient cargo is not falsely marked rescued or delivered.
- Recovery samples after the replay clock are hypothetical future outcomes. Exclude them from baseline planning.

## Minimal local load

No model/API credentials or additional packages are needed to load the operational JSON and CSV records:

```python
import csv
import json
from pathlib import Path

shipments = json.loads(Path("data/seed/shipments.json").read_text())["records"]
incident = json.loads(Path("data/scenarios/breakdown.json").read_text())["incident"]
with Path("data/sensors/gradual_rise.csv").open(newline="") as stream:
    readings = list(csv.DictReader(stream))
```

## Limits and unavailable private resources

Linear extrapolation and excursion allowances are fictional dispatch scoring constraints, **not a vaccine viability assessment**. Real products require current manufacturer/product-specific policies and appropriate human escalation. Invented driver duty budgets are not legal compliance rules.

The reefer photos were taken in China and the roadside-breakdown photo in Kenya; none depicts the fictional Hosur incident. The rendered display is not a photograph; voice notes are not human recordings. No authentic evidence of the canonical incident or private fleet dataset was obtained. Sidecars explicitly state what each modality does and does not support.

No API keys, Google account, OAuth tokens, Sheet/Calendar IDs, real fleet access, live bookings or real customer data were collected. Those require team-controlled accounts. Official setup links and prerequisites are cataloged under `references/`. Multimodal extraction and agent self-healing/learning still need to be exercised by the application team with their chosen Gemini models.

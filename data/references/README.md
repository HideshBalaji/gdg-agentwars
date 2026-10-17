# Public references for Ghost Dispatcher

This folder contains **real public references**, not operational shipment data or evidence of a real rescue. `source_catalog.json` links official resources opened during collection; `accessed_at` records this collection session, not publication dates. Online pages can change. No SDK version, model availability, numeric quota, account entitlement, or provider capability is guaranteed by the catalog.

## Contents and provenance

- `source_catalog.json`: UTF-8 JSON object with `schema_version`, collection metadata, `sources[]`, and `retrieval_limitations[]`. Each source has deterministic `id`, `title`, `url`, `publisher`, timezone-aware `accessed_at`, `resource_type`, `license_or_reuse_notes`, `what_it_enables`, and optional relative `local_copy`. Notes are original paraphrases, not copied web pages.
- `cdc_vaccine_storage_handling_toolkit.pdf`: genuine, unmodified CDC toolkit, July 2026, downloaded over HTTPS after opening its exact URL with the reader. It is not generated or simulated.
- `download_provenance.json`: `assets[]` records source ID, requested/effective URL, retrieval time, HTTP status, content type, byte length, SHA-256, and reuse basis for the PDF. Download: **1,593,615 bytes**, `application/pdf`; SHA-256 `f540ead5f32c8711a1a8b4b0c7dfca4273fc3b869b3dd6045d613b668c899c9c`.

**Source: CDC. Materials developed by the U.S. Centers for Disease Control and Prevention.** The original is available **free of charge** at [CDC's toolkit URL](https://www.cdc.gov/vaccines/hcp/downloads/storage-handling-toolkit.pdf). This project, its services, and its use of or links to these materials are **not endorsed by CDC, ATSDR, HHS, or the United States Government**. The PDF's substantive content is unchanged. [CDC's reuse policy](https://www.cdc.gov/other/agencymaterials.html) permits reuse of its public-domain content subject to these conditions, but excludes some third-party content and protects marks; international copyright may differ. Embedded marks/images are not licensed for separate extraction or promotion. Check the [live toolkit page](https://www.cdc.gov/vaccines/hcp/storage-handling/index.html) for revisions before use.

WHO's updated guide is linked, not mirrored; its page displays CC BY-NC-SA 3.0 IGO. India-relevant official NHM guidance indexes and cold-chain context are linked. Older MoHFW PDF URLs returned 404 and direct NHM handbook reader fetches aborted; these limitations are recorded, not presented as downloaded or read guidance. No copying permission was established for those Indian handbooks. The NCCVMRC portal was title-verified only. No external illustrative photos or generated assets are collected in this folder, and no copied reference is represented as synthetic.

## Safety boundary

The operational demo elsewhere is synthetic and replays **2026-10-17T02:00:00+05:30**, not live conditions. SHP-001, TN-07, DRV-007, and INC-001 are fictional demo identifiers. Neither this catalog nor a linear temperature estimate establishes vaccine potency, safety, or viability. A linear estimate is an illustrative urgency heuristic, **not a vaccine viability assessment**, product stability model, or permission to release/administer cargo. It does not model freezing damage, gradients, sensor uncertainty, packaging, or product-specific stability.

For an actual excursion, follow the product manufacturer's current instructions, qualified public-health/pharmaceutical advice, calibrated monitoring records, and applicable local procedures. CDC is U.S. guidance, not an assertion of Indian requirements. Rescue must restore controlled conditions **before the thermal deadline**; onward delivery has a **separate business deadline**. Arrival before the business deadline cannot undo an excursion or prove viability. Search results for a garage, cold store, or hospital do not prove acceptance, capacity, equipment, suitability, or any agreement to help.

## User-controlled setup that cannot be collected publicly

No keys, accounts, OAuth clients, tokens, private mail/calendar/sheets, cloud databases, or real shipment/personal records have been obtained. Live integration requires the user's own authorized setup:

1. **ADK / Gemini:** install the Python environment from the linked ADK quickstart; obtain the user's Gemini API or supported Google Cloud authentication, appropriate project access, and billing if required. Select a model from the live catalog and inspect the project's actual limits in authenticated AI Studio. Public documentation cannot establish these account-specific values.
2. **Maps Routes / Places / Weather:** create/select the user's Cloud project, enable each intended API, satisfy its account/billing requirements, and configure restricted credentials. Public docs are not collected API responses. Check API-specific terms, attribution, caching/storage rules, coverage, and production requirements before collecting outputs.
3. **Gmail / Calendar / Sheets:** enable each API in the user's project, configure OAuth branding/audience and test users where applicable, create the appropriate client type (desktop for a local demo), and obtain interactive user consent. Internal audience is for eligible Workspace organizations; personal-account/external demos need the appropriate External setup. Follow the catalog's Python quickstarts for `google-api-python-client`, `google-auth-httplib2`, and `google-auth-oauthlib`; they are setup examples, not production authorization designs. Sensitive scopes can require verification for external production use. The user must supply the destination calendar/spreadsheet and own or have suitable access to them.
4. **Optional persistence:** SQLite needs a local installation/runtime and writable local storage, not a cloud account. Firestore needs an authorized user-owned project/database and suitable IAM/authentication; privileged server clients are not constrained by mobile/web security rules. Do not deploy publicly writable test rules or commit service-account keys.

Use least privilege for intended **writes**, not the readonly quickstart defaults:

| Intended operation | OAuth scope | Boundary |
| --- | --- | --- |
| Send incident/rescue mail | `https://www.googleapis.com/auth/gmail.send` | Sending only; does not read the inbox. Add read permission only if the actual feature requires it. |
| Read/create/change owned-calendar events | `https://www.googleapis.com/auth/calendar.events.owned` | Prefer for a user-owned demo calendar. |
| Read/write events on authorized shared calendars, if needed | `https://www.googleapis.com/auth/calendar.events` | Broader event access; does not grant underlying calendar access by itself. |
| Read/write a demo spreadsheet created by or explicitly authorized for the app | `https://www.googleapis.com/auth/drive.file` | Recommended per-file alternative; a pasted existing file ID alone is not an app file authorization flow. |
| Read/write broader Sheets files only when necessary | `https://www.googleapis.com/auth/spreadsheets` | Broader sensitive permission; scopes cannot be narrowed to an individual tab. |

Scope references in the catalog are the authority for these choices. Avoid unrestricted mailbox, full calendar administration, or full Drive scopes for this demo. Changing scopes requires a new consent grant; an existing readonly token does not acquire write privileges automatically. Keep client-secret files, access/refresh tokens, service-account material, and environment secrets outside committed data. Use designated test recipients and explicitly authorized demo calendars/sheets rather than real dispatch side effects.

# Guardrails and agent evaluation

Two safety properties are enforced in code and measured on every CI run:

1. **No personal data in or out.** Phone numbers, email addresses, Aadhaar numbers, payment cards, PAN and UPI IDs are removed before they are stored, shown, or sent to Gemini, and before anything Gemini says reaches a user.
2. **Agents only state what their tools returned.** Every truck/carrier/shipment ID, rupee amount, time, duration, distance and booking/rescue status in an agent reply must be backed by that turn's tool results.

Both checks are deterministic Python (no LLM), so they behave the same offline and live.

## 1. PII guardrails

**Detector:** `ghost_dispatcher/services/guardrails.py`

| Kind | Example | Notes |
|---|---|---|
| `PHONE` | `+91 98765 43210`, `9876543210`, `+1 (415) 555-0132` | Indian mobiles with or without +91/0; international numbers with a leading `+` and 8–15 digits |
| `EMAIL` | `ravi.k@example.com` | |
| `AADHAAR` | `1234 5678 9012` | 12 digits, never part of a longer number |
| `CARD` | `4111 1111 1111 1111` | 13–19 digits with an issuer prefix and a Luhn check (or 4-4-4-4 grouping) |
| `PAN` | `ABCDE1234F` | |
| `UPI` | `ravi@okaxis` | |

Matches become `[REDACTED:KIND]`. Operational data is deliberately left alone, including truck, shipment, carrier and dock IDs, number plates, ISO timestamps, coordinates, costs, hex IDs and epoch timestamps. Tests cover both directions (`tests/test_guardrails.py`).

**Where it is enforced**

| Boundary | Mechanism | File |
|---|---|---|
| API input | `SafeText` contract fields (incident description, chat message, feedback reason) redact on parse, so the clean form is all that is ever stored. `GHOST_PII_MODE=block` instead rejects such requests with `422 {"code": "pii_blocked", "kinds": …}` before any handler runs | `models/contracts.py`, `http_guard.py` |
| Gemini input | ADK `before_model_callback` on every agent redacts user text, chat history, tool arguments and tool results in the `LlmRequest` | `agents/team.py` |
| Tool results | ADK `after_tool_callback` redacts results before the model or the ADK session store sees them | `agents/team.py` |
| Gemini output | ADK `after_model_callback` redacts model text and function-call arguments, so replies and stored session events stay clean | `agents/team.py` |
| MCP | Every `logistics-mcp` tool result is redacted before it leaves the server | `mcp_server/server.py` |
| Event stream | `Store.emit` deep-redacts every SSE event | `services/store.py` |
| API output | The middleware deep-redacts every JSON response under `/api/` and adds `X-PII-Redacted: PHONE=1,…` when input was redacted | `http_guard.py` |
| Prompt | Agents are told never to repeat personal data and to quote IDs, costs and times only from tool results | `agents/team.py` |

Each redaction emits a `guardrail` SSE event, for example `{"stage": "input" | "model_input" | "tool_output" | "model_output", "kinds": {"PHONE": 1}, "total": 1}`. It records the kind and count, never the value. `GET /health` reports `pii_mode`.

**Limits:** uploaded photos and audio are stored as files and, in live mode, sent to Gemini as media. They cannot be redacted. The prompt rule and the output redaction stop the model from repeating identifiers it reads in them. Names and street addresses are not detected.

## 2. Groundedness and truthfulness

**Checker:** `ghost_dispatcher/services/grounding.py` extracts claims from a reply (IDs such as `TN-02` and `CAR-001`, `₹` and INR amounts, `HH:MM` times, minutes, km, and "booked/confirmed/resolved/rescued" status words, skipping negations like "not booked yet"). It checks each claim against the evidence: that turn's tool results, the stored incident, and learned preferences.

- **At runtime** (`agents/conversations.py`): every agent reply carries a `grounding` object `{score, grounded, claims, unsupported}`, and a `grounding` SSE event is emitted. If anything is unsupported, the reply gains a visible line, `[Guardrail] Not backed by tool results: TN-09, ₹9,999. Treat as unverified.`
- **Hard constraints** stay in code (`services/validation.py`), so a made-up plan can never be booked, whatever the model says.

## 3. Agent evaluation (`make eval`)

`ghost-eval` (`ghost_dispatcher/evaluation/run.py`) runs four suites and writes `runs/eval-report.json`. It exits non-zero on any failure and runs in CI and `make verify`.

| Suite | What it measures | Pass bar |
|---|---|---|
| `adk_agent_eval` | ADK `AgentEvaluator` on `evals/offline/agent.test.json` against the real 8-agent team: **tool trajectory** (EXACT match, including `transfer_to_agent` handovers), plus custom metrics **groundedness** and **pii_free** (`ghost_dispatcher/evaluation/metrics.py`). Cases: plan a rescue, a chat message containing a phone/Aadhaar/card/email, explicit switch to the validator, and "too expensive" feedback | 1.0 on every metric |
| `pii_end_to_end` | Sends a phone, Aadhaar, card and email through the incident description, a chat message and feedback. Searches the API responses, the SSE stream, the main SQLite database and the ADK session database for every raw and digits-only variant. Also checks that block mode returns 422 and still accepts a clean request | zero leaks |
| `grounding_labelled` | The checker against 12 human-labelled replies (`evals/grounding_cases.json`: fabricated IDs, wrong costs and times, false "booked" and "rescue complete" claims, plus correct and negated statements) | 100% agreement |
| `scenario_grounding` | A six-turn conversation through the API (plan, why, switch, back, execute, feedback); every reply's runtime grounding score | 1.0 for every reply |

A negative control was run while building this: with redaction switched off, `pii_end_to_end` finds 20 leaks across all four surfaces. That reproduces the original audit. With it on, there are none.

**Live Gemini:** `make eval-live` (with the live `.env`) runs the same eval set against real Gemini with trajectory matching relaxed to `IN_ORDER`. It adds ADK's **`hallucinations_v1`** LLM-judge metric (threshold 0.8, judge = `GEMINI_FLASH_MODEL`). This needs credentials and is not part of CI. Offline results use the deterministic model double, so they prove the plumbing, the trajectories and the guardrails, not real-model behaviour.

## 4. Multi-agent orchestration (for reference)

A root `dispatcher` with seven specialists (`agents/team.py`): handover runs through ADK `transfer_to_agent`, capped at 4 per message and restricted to known agents. A `LoopAgent` handles plan/validate with at most 3 iterations, and live specialists get read-only MCP tools. Everything runs in one process, and Google's agent-to-agent (A2A) protocol is not used.

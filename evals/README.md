# Evals

```bash
make eval        # offline: ADK trajectory/groundedness/PII, end-to-end leak test, labelled hallucinations, scenario
make eval-live   # real Gemini + hallucinations_v1 judge (needs the live .env)
```

| File | Purpose |
|---|---|
| `offline/agent.test.json` | ADK `EvalSet`: four cases run against the real agent team (`ghost_dispatcher.evaluation.agent`) on an isolated, freshly seeded database |
| `offline/test_config.json` | Criteria: `tool_trajectory_avg_score` (EXACT) = 1.0, custom `groundedness` = 1.0, custom `pii_free` = 1.0 |
| `grounding_cases.json` | 12 human-labelled replies (grounded vs hallucinated) for the groundedness checker |

Results are written to `runs/eval-report.json`. See [docs/GUARDRAILS_AND_EVALS.md](../docs/GUARDRAILS_AND_EVALS.md) for what each suite measures and its limits.

To add a case, append an `EvalCase` to `offline/agent.test.json` with the user text and the expected tool calls, then run `make eval`.

"""ghost-eval: replay the ADK eval set through the real agent team and score every case.

Each case runs on a fresh copy of the collected dataset, through the same conversation path
the UI uses (guardrails, A2A carrier agent, quality monitor). Scored with:

* ADK TrajectoryEvaluator: expected tool calls, handovers and A2A calls, in order;
* the live quality monitor: groundedness, truthfulness, hallucination per reply;
* case expectations: incident status, fallback carrier, guardrail blocks;
* optional ADK HallucinationsV1 LLM judge on Gemini (--judge, needs GOOGLE_API_KEY).

Offline mode needs no keys and is deterministic; exits non-zero if any case fails."""

import argparse
import asyncio
import json
import os
import sys
import tempfile
from dataclasses import replace
from pathlib import Path

from dotenv import load_dotenv
from google.adk.evaluation.eval_case import IntermediateData, Invocation
from google.adk.evaluation.eval_metrics import (
    EvalMetric,
    HallucinationsCriterion,
    JudgeModelOptions,
    ToolTrajectoryCriterion,
)
from google.adk.evaluation.eval_set import EvalSet
from google.adk.evaluation.trajectory_evaluator import TrajectoryEvaluator
from google.genai import types

from ghost_dispatcher.agents.conversations import Conversations
from ghost_dispatcher.config import Settings
from ghost_dispatcher.models.contracts import IncidentCreate, Message
from ghost_dispatcher.services.dispatcher import DispatcherService
from ghost_dispatcher.services.store import DomainError

EVALSET = Path("evals/ghost_dispatcher.evalset.json")
THRESHOLDS = {"trajectory": 1.0, "groundedness": 0.9, "truthfulness": 1.0}


def _text(content):
    return " ".join(p.text for p in (content.parts if content else None) or [] if p.text)


async def run_case(case, settings, judge=None):
    setup = dict(case.session_input.state.get("ghost", {})) if case.session_input else {}
    expect = setup.pop("expect", {})
    with tempfile.TemporaryDirectory(prefix="ghost-eval-") as directory:
        service = DispatcherService(replace(settings, database=f"{directory}/eval.sqlite"))
        service.bootstrap()
        for carrier in setup.get("kill_carriers", []):
            service.carriers.health(carrier, False)
        incident = service.create_incident(
            IncidentCreate(
                shipment_id=setup.get("shipment_id", "SHP-001"),
                type=setup.get("type", "truck_breakdown"),
                description=setup.get("description", "Evaluation incident"),
            )
        )
        conversations = Conversations(service)
        actual, blocked = [], []
        try:
            conversation = await conversations.create(incident.id)
            for number, expected in enumerate(case.conversation, start=1):
                # Inject a provider outage mid-conversation (after planning, before booking).
                for carrier in setup.get("kill_before_turn", {}).get(str(number), []):
                    service.carriers.health(carrier, False)
                calls, responses = [], []

                def observe(event, calls=calls, responses=responses):
                    calls.extend(event.get_function_calls())
                    responses.extend(event.get_function_responses())

                text = _text(expected.user_content)
                try:
                    reply = await conversations.send(
                        conversation["id"], Message(text=text), observer=observe
                    )
                    final = "\n".join(r["text"] for r in reply["replies"])
                except DomainError as error:
                    blocked.append(error.code)
                    final = f"[BLOCKED:{error.code}] {error.message}"
                actual.append(
                    Invocation(
                        invocation_id=expected.invocation_id,
                        user_content=expected.user_content,
                        final_response=types.Content(role="model", parts=[types.Part(text=final)]),
                        intermediate_data=IntermediateData(
                            tool_uses=calls, tool_responses=responses
                        ),
                    )
                )
        finally:
            await conversations.close()

        live = settings.mode == "live"
        trajectory = TrajectoryEvaluator(
            eval_metric=EvalMetric(
                metric_name="tool_trajectory_avg_score",
                threshold=THRESHOLDS["trajectory"],
                criterion=ToolTrajectoryCriterion(
                    threshold=THRESHOLDS["trajectory"],
                    # Gemini may legitimately add or reorder calls; offline is exact.
                    match_type="ANY_ORDER" if live else "EXACT",
                    ignore_args=live,
                ),
            )
        ).evaluate_invocations(actual, case.conversation)
        evaluations = [
            e for e in service.store.list("evaluation") if e["incident_id"] == incident.id
        ]
        final_incident = service.incident(incident.id)
        checks = {}
        if "incident_status" in expect:
            checks["incident_status"] = final_incident.status == expect["incident_status"]
        if "booking_carrier_not" in expect:
            booking = final_incident.actions.get("booking") or {}
            checks["fallback_carrier"] = booking.get("carrier_id") not in (
                None,
                expect["booking_carrier_not"],
            )
        if expect.get("preference"):
            checks["preference_saved"] = bool(service.store.list("preference"))
        if "blocked" in expect:
            checks["guardrail_blocked"] = expect["blocked"] in blocked
        if expect.get("a2a"):
            checks["a2a_exchange"] = any(
                e.type == "a2a" and e.data["direction"] == "response"
                for e in service.store.events(incident.id)
            )
        result = {
            "case": case.eval_id,
            "trajectory": trajectory.overall_score,
            "groundedness": min((e["groundedness"] for e in evaluations), default=1.0),
            "truthfulness": min((e["truthfulness"] for e in evaluations), default=1.0),
            "hallucinated_replies": sum(e["hallucinated"] for e in evaluations),
            "checks": checks,
        }
        if judge:
            outcome = await judge.evaluate_invocations(actual)
            result["llm_judge_hallucinations_v1"] = outcome.overall_score
        result["passed"] = (
            (result["trajectory"] or 0) >= THRESHOLDS["trajectory"]
            and result["groundedness"] >= THRESHOLDS["groundedness"]
            and result["truthfulness"] >= THRESHOLDS["truthfulness"]
            and result["hallucinated_replies"] == 0
            and all(checks.values())
        )
        return result


async def run(path=EVALSET, judge=False, mode="offline"):
    load_dotenv()
    base = (
        Settings.from_env()
        if mode == "live"
        else Settings(flash_model=os.getenv("GEMINI_FLASH_MODEL", ""))
    )
    settings = replace(
        base,
        dataset="collected",
        data_dir=str(Path.cwd() / "data"),
        mode=mode,
    )
    eval_set = EvalSet.model_validate_json(Path(path).read_text())
    judge_evaluator = None
    if judge:
        from google.adk.evaluation.hallucinations_v1 import HallucinationsV1Evaluator

        if not settings.flash_model:
            raise SystemExit("--judge needs GEMINI_FLASH_MODEL and GOOGLE_API_KEY in .env")
        judge_evaluator = HallucinationsV1Evaluator(
            EvalMetric(
                metric_name="hallucinations_v1",
                threshold=0.8,
                criterion=HallucinationsCriterion(
                    threshold=0.8,
                    judge_model_options=JudgeModelOptions(judge_model=settings.flash_model),
                ),
            )
        )
    results = [await run_case(case, settings, judge_evaluator) for case in eval_set.eval_cases]
    return {
        "eval_set": eval_set.eval_set_id,
        "mode": mode,
        "simulated": mode == "offline",
        "thresholds": THRESHOLDS,
        "passed": all(r["passed"] for r in results),
        "cases": results,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--evalset", default=str(EVALSET))
    parser.add_argument("--live", action="store_true", help="run against real Gemini models")
    parser.add_argument("--judge", action="store_true", help="add the ADK Gemini LLM judge")
    parser.add_argument("--output", default="runs/eval-report.json")
    args = parser.parse_args(argv)
    report = asyncio.run(
        run(args.evalset, judge=args.judge, mode="live" if args.live else "offline")
    )
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2))
    width = max(len(r["case"]) for r in report["cases"])
    for r in report["cases"]:
        print(
            f"{'PASS' if r['passed'] else 'FAIL'}  {r['case']:<{width}}  "
            f"trajectory={r['trajectory']:.2f}  grounded={r['groundedness']:.2f}  "
            f"truthful={r['truthfulness']:.2f}  hallucinated={r['hallucinated_replies']}  "
            f"checks={json.dumps(r['checks'])}"
            + (
                f"  judge={r['llm_judge_hallucinations_v1']}"
                if "llm_judge_hallucinations_v1" in r
                else ""
            )
        )
    print(f"{'PASSED' if report['passed'] else 'FAILED'} ({report['mode']}); report: {args.output}")
    sys.exit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()

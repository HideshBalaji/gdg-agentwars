"""`make eval`: agent evaluation and guardrail checks with a pass/fail report.

Suites (all offline and deterministic unless --live):
  adk_agent_eval      ADK AgentEvaluator on evals/offline: exact tool trajectory,
                      groundedness and PII-free custom metrics on the real team.
  pii_end_to_end      Personal data sent through the HTTP API never appears in
                      responses, the event stream or either SQLite store; block
                      mode rejects it with 422.
  grounding_labelled  The groundedness checker agrees with human labels on
                      grounded vs hallucinated replies (accuracy must be 100%).
  scenario_grounding  Every agent reply in a multi-turn conversation is grounded
                      in that turn's tool results.
With --live, the ADK eval runs on real Gemini and adds the hallucinations_v1
LLM-judge metric (needs GOOGLE_API_KEY and the live .env).
"""

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVALS = ROOT / "evals"
PII = {
    "phone": "+91 98765 43210",
    "aadhaar": "1234 5678 9012",
    "card": "4111 1111 1111 1111",
    "email": "ravi.k@example.com",
}
PII_VARIANTS = [*PII.values(), "9876543210", "123456789012", "4111111111111111", "ravi.k@example"]


def _client(database: str):
    from fastapi.testclient import TestClient

    from ghost_dispatcher.api import create_app
    from ghost_dispatcher.config import Settings

    settings = Settings(database=database, dataset="collected", data_dir=str(ROOT / "data"))
    client = TestClient(create_app(settings))
    client.headers["Authorization"] = "Bearer ghost-demo"
    return client


def adk_agent_eval(live: bool) -> dict:
    from google.adk.evaluation.agent_evaluator import AgentEvaluator

    folder = EVALS / "offline"
    if live:
        os.environ["GHOST_EVAL_MODE"] = "live"
        tmp = Path(tempfile.mkdtemp(prefix="ghost-live-eval-"))
        shutil.copy(folder / "agent.test.json", tmp / "agent.test.json")
        config = json.loads((folder / "test_config.json").read_text())
        config["criteria"]["tool_trajectory_avg_score"]["match_type"] = "IN_ORDER"
        config["criteria"]["hallucinations_v1"] = {"threshold": 0.8, "judge_model_options": {"judge_model": os.getenv("GEMINI_FLASH_MODEL") or "gemini-2.5-flash"}}
        (tmp / "test_config.json").write_text(json.dumps(config))
        folder = tmp
    try:
        asyncio.run(AgentEvaluator.evaluate("ghost_dispatcher.evaluation.agent", str(folder), num_runs=1, print_detailed_results=False))
        return {"passed": True, "detail": "trajectory, groundedness and pii_free met their thresholds"}
    except AssertionError as error:
        return {"passed": False, "detail": str(error)[:2000]}


def pii_end_to_end() -> dict:
    tmp = tempfile.mkdtemp(prefix="ghost-pii-")
    db = f"{tmp}/ghost.sqlite"
    client = _client(db)
    leaks: list[str] = []
    text = f"Driver phone {PII['phone']}, Aadhaar {PII['aadhaar']}, card {PII['card']}, email {PII['email']}"
    with client:
        r = client.post("/api/incidents", json={"shipment_id": "SHP-001", "type": "truck_breakdown", "description": f"Breakdown near Hosur. {text}"})
        incident = r.json()["id"]
        bodies = [r.text]
        conv = client.post("/api/conversations", json={"incident_id": incident}).json()["id"]
        bodies.append(client.post(f"/api/conversations/{conv}/messages", json={"text": f"Plan a rescue. {text}"}).text)
        bodies.append(client.post(f"/api/incidents/{incident}/feedback", json={"rating": "down", "reason": f"Too expensive. {text}", "prefer_cheaper_when_slack": True}).text)
        bodies.append(client.get(f"/api/incidents/{incident}").text)
        bodies.append(client.get(f"/api/conversations/{conv}").text)
        events = client.get(f"/api/incidents/{incident}/events").text
        guardrail_events = events.count("event: guardrail")

        os.environ["GHOST_PII_MODE"] = "block"
        try:
            blocked = client.post("/api/incidents", json={"shipment_id": "SHP-001", "type": "truck_breakdown", "description": text})
            clean = client.post("/api/incidents", json={"shipment_id": "SHP-001", "type": "truck_breakdown", "description": "Clean report"})
        finally:
            os.environ.pop("GHOST_PII_MODE", None)

    surfaces = {"api_responses": "\n".join(bodies), "event_stream": events}
    for path in Path(tmp).glob("ghost.sqlite*"):
        surfaces[f"storage:{path.name}"] = path.read_bytes().decode("utf-8", "ignore")
    for surface, content in surfaces.items():
        leaks += [f"{surface}: {v}" for v in PII_VARIANTS if v in content]
    checks = {
        "no_leaks": not leaks,
        "redaction_recorded": guardrail_events >= 3,
        "block_mode_rejects": blocked.status_code == 422 and blocked.json().get("code") == "pii_blocked",
        "block_mode_allows_clean": clean.status_code == 201,
        "surfaces_checked": len(surfaces),
    }
    passed = all(v for k, v in checks.items() if k != "surfaces_checked")
    return {"passed": passed, "checks": checks, "leaks": leaks}


def grounding_labelled() -> dict:
    from ghost_dispatcher.services.grounding import check

    data = json.loads((EVALS / "grounding_cases.json").read_text())
    rows, tp, tn, fp, fn = [], 0, 0, 0, 0
    for case in data["cases"]:
        got = check(case["text"], data["evidence"]).grounded
        want = case["grounded"]
        tp += got and want
        tn += (not got) and (not want)
        fp += got and not want
        fn += (not got) and want
        if got != want:
            rows.append(case["text"])
    total = len(data["cases"])
    accuracy = (tp + tn) / total
    caught = tn / max(1, tn + fp)
    return {
        "passed": accuracy == 1.0,
        "cases": total,
        "accuracy": round(accuracy, 3),
        "hallucinations_caught": round(caught, 3),
        "false_alarms": fn,
        "mismatches": rows,
    }


def scenario_grounding() -> dict:
    client = _client(f"{tempfile.mkdtemp(prefix='ghost-scn-')}/ghost.sqlite")
    turns = [
        "Plan a rescue",
        "Why this vehicle?",
        "Switch to validator. Is the current plan valid?",
        "Back to coordinator",
        "Execute the rescue booking.",
        "Too expensive, prefer the cheaper carrier next time.",
    ]
    scores = []
    with client:
        incident = client.post("/api/incidents", json={"shipment_id": "SHP-001", "type": "truck_breakdown", "description": "Scenario"}).json()["id"]
        conv = client.post("/api/conversations", json={"incident_id": incident}).json()["id"]
        for text in turns:
            reply = client.post(f"/api/conversations/{conv}/messages", json={"text": text}).json()
            for r in reply.get("replies", []):
                g = r.get("grounding", {})
                scores.append({"turn": text, "agent": r.get("agent"), "score": g.get("score"), "unsupported": g.get("unsupported")})
    worst = min((s["score"] for s in scores), default=1.0)
    return {"passed": bool(scores) and worst == 1.0, "replies": len(scores), "min_score": worst, "details": scores}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--live", action="store_true", help="evaluate real Gemini (needs live .env)")
    parser.add_argument("--report", default=str(ROOT / "runs" / "eval-report.json"))
    args = parser.parse_args()

    suites = {
        "adk_agent_eval": lambda: adk_agent_eval(args.live),
        "pii_end_to_end": pii_end_to_end,
        "grounding_labelled": grounding_labelled,
        "scenario_grounding": scenario_grounding,
    }
    results, started = {}, time.time()
    for name, run in suites.items():
        try:
            results[name] = run()
        except Exception as error:  # noqa: BLE001 - a crashed suite is reported as failed
            results[name] = {"passed": False, "detail": f"{type(error).__name__}: {error}"}
        status = "PASS" if results[name]["passed"] else "FAIL"
        summary = {k: v for k, v in results[name].items() if k not in {"details", "detail", "leaks", "mismatches"}}
        print(f"[{status}] {name}: {json.dumps(summary)}")
        if not results[name]["passed"]:
            print("       " + json.dumps({k: results[name].get(k) for k in ("detail", "leaks", "mismatches") if results[name].get(k)})[:1500])

    report = {"mode": "live" if args.live else "offline", "seconds": round(time.time() - started, 1), "results": results}
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2, default=str))
    passed = all(r["passed"] for r in results.values())
    print(f"\n{'All evals passed' if passed else 'Evals FAILED'} · report: {args.report}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()

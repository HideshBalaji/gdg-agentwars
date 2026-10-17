"""Live answer-quality monitor. Every agent reply is scored before the user acts on it:

* groundedness  - share of factual claims (IDs, timestamps, times, money, quantities) that are
                  backed by this turn's tool results or the incident record;
* truthfulness  - share of state claims (booked, resolved, assigned to X) that match the
                  operational store, which is the source of truth;
* hallucination - any claim that is unsupported, names an entity that does not exist, or
                  contradicts the store.

Scores are deterministic, need no model and are stored per reply for monitoring."""

import json
import re
from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

IST = timezone(timedelta(hours=5, minutes=30))
_ISO = re.compile(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?")
_ID = re.compile(r"\b(?:[A-Z]{2,4}-\d{1,4}(?:-[A-Za-z0-9]+)*|[0-9a-f]{32})\b")
_MONEY = re.compile(
    r"(?:INR|Rs\.?|₹)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:INR|demo[_ ]units|rupees)\b",
    re.IGNORECASE,
)
_TIME = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")
_QUANTITY = re.compile(r"\b(\d+(?:\.\d+)?)\s?(minutes?|mins?|km|kg|hours?)\b", re.IGNORECASE)
_BOOKED = re.compile(
    r"\b(booking (?:is |was )?confirmed|confirmed (?:the |a )?booking|is booked)\b", re.IGNORECASE
)
_RESOLVED = re.compile(
    r"\b(rescue (?:is |was )?(?:complete|completed|resolved)|incident (?:is |was )?resolved)\b",
    re.IGNORECASE,
)
_ASSIGNED = re.compile(
    r"\b(?:assigned to|reassigned to|transferred to|rescued by)\s+(?:truck\s+)?([A-Z]{2}-\d{2})\b",
    re.IGNORECASE,
)


def _leaves(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _leaves(item)
    elif isinstance(value, list):
        for item in value:
            yield from _leaves(item)
    else:
        yield value


def _number(text):
    return float(text.replace(",", ""))


def _instant(text):
    try:
        value = datetime.fromisoformat(text)
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class Evidence:
    def __init__(self, sources):
        self.text, self.numbers, self.instants, self.clock = [], [], set(), set()
        for leaf in _leaves(sources):
            if isinstance(leaf, bool) or leaf is None:
                continue
            if isinstance(leaf, int | float):
                self.numbers.append(float(leaf))
                continue
            leaf = str(leaf)
            self.text.append(leaf)
            for match in _ISO.finditer(leaf):
                if instant := _instant(match.group()):
                    self.instants.add(instant)
                    for zone in (instant.tzinfo, UTC, IST):
                        self.clock.add(instant.astimezone(zone).strftime("%H:%M"))
            for match in re.finditer(r"-?\d[\d,]*(?:\.\d+)?", _ISO.sub(" ", leaf)):
                self.numbers.append(_number(match.group().lstrip("-")))
        self.blob = "\n".join(self.text)

    def has_number(self, value):
        return any(abs(value - n) <= max(0.5, abs(n) * 0.005) for n in self.numbers)


class QualityMonitor:
    def __init__(self, service):
        self.service = service
        self.store = service.store

    def _known_ids(self):
        known = set()
        for kind in ("truck", "shipment", "carrier", "warehouse", "incident", "booking"):
            for row in self.store.list(kind):
                known.add(row["id"])
                for key in ("driver_id", "customer_id", "carrier_id", "truck_id", "shipment_id"):
                    if row.get(key):
                        known.add(row[key])
                for window in row.get("dock_windows", []):
                    known.add(window["id"])
        return known

    def score(self, incident_id, text, tool_results):
        """Score one reply against the turn's tool results and the operational store."""
        incident = self.service.incident(incident_id)
        evidence = Evidence([tool_results, incident.model_dump(mode="json")])
        known = self._known_ids()
        body = re.sub(r"^\[SIMULATED / [a-z_]+\]\s*", "", text)
        claims, unsupported = [], []

        def claim(kind, value, supported, reason=""):
            claims.append(kind)
            if not supported:
                unsupported.append({"kind": kind, "value": value, "reason": reason})

        for match in _ISO.finditer(body):
            instant = _instant(match.group())
            claim("timestamp", match.group(), instant in evidence.instants, "no source timestamp")
        rest = _ISO.sub(" ", body)
        for match in _ID.finditer(rest):
            value = match.group()
            if value in evidence.blob:
                claim("identifier", value, True)
            elif value in known:
                claim("identifier", value, False, "exists, but not in this turn's evidence")
            else:
                claim("identifier", value, False, "entity does not exist")
        for match in _MONEY.finditer(rest):
            value = _number(match.group(1) or match.group(2))
            claim("money", match.group(), evidence.has_number(value), "amount not in evidence")
        for match in _TIME.finditer(rest):
            claim(
                "time",
                match.group(),
                match.group().zfill(5) in evidence.clock,
                "time not in evidence",
            )
        for match in _QUANTITY.finditer(_TIME.sub(" ", rest)):
            claim(
                "quantity",
                match.group(),
                evidence.has_number(float(match.group(1))),
                "quantity not in evidence",
            )

        checks, contradictions = 0, []
        booking = incident.actions.get("booking") or {}
        assigned = (incident.actions.get("assignment") or {}).get("truck_id")
        chosen = incident.plan.chosen.truck_id if incident.plan else None
        if _BOOKED.search(body):
            checks += 1
            if booking.get("status") != "confirmed":
                contradictions.append(
                    {"claim": "booking confirmed", "store": "no confirmed booking"}
                )
        if _RESOLVED.search(body):
            checks += 1
            if incident.status != "resolved":
                contradictions.append({"claim": "rescue resolved", "store": incident.status})
        for match in _ASSIGNED.finditer(body):
            checks += 1
            if match.group(1).upper() not in {assigned, chosen}:
                contradictions.append(
                    {"claim": f"assigned to {match.group(1)}", "store": assigned or chosen}
                )

        total = len(claims)
        return {
            "groundedness": round((total - len(unsupported)) / total, 3) if total else 1.0,
            "truthfulness": round((checks - len(contradictions)) / checks, 3) if checks else 1.0,
            "hallucinated": bool(unsupported or contradictions),
            "claims": total,
            "state_checks": checks,
            "unsupported": unsupported[:20],
            "contradictions": contradictions,
        }

    def evaluate(self, incident_id, agent, text, tool_results):
        result = {
            "id": uuid4().hex,
            "incident_id": incident_id,
            "agent": agent,
            "at": datetime.now(UTC).isoformat(),
            "simulated": self.service.settings.mode == "offline",
            **self.score(incident_id, text, tool_results),
        }
        self.store.put("evaluation", result["id"], result)
        self.store.emit(incident_id, "evaluation", result)
        return result

    def summary(self, incident_id=None):
        evaluations = [
            e
            for e in self.store.list("evaluation")
            if incident_id is None or e["incident_id"] == incident_id
        ]
        agents = {}
        for item in evaluations:
            agents.setdefault(item["agent"], []).append(item)

        def aggregate(items):
            count = len(items)
            return {
                "replies": count,
                "groundedness": round(sum(i["groundedness"] for i in items) / count, 3),
                "truthfulness": round(sum(i["truthfulness"] for i in items) / count, 3),
                "hallucination_rate": round(sum(i["hallucinated"] for i in items) / count, 3),
            }

        guardrails = [
            g
            for g in self.store.list("guardrail")
            if incident_id is None or g["incident_id"] == incident_id
        ]
        a2a = [
            e
            for incident in (
                [incident_id] if incident_id else [i["id"] for i in self.store.list("incident")]
            )
            for e in self.store.events(incident)
            if e.type == "a2a"
        ]
        return {
            "overall": aggregate(evaluations) if evaluations else None,
            "agents": {name: aggregate(items) for name, items in sorted(agents.items())},
            "flagged": [
                {
                    k: e[k]
                    for k in ("id", "incident_id", "agent", "at", "unsupported", "contradictions")
                }
                for e in evaluations
                if e["hallucinated"]
            ][-20:],
            "guardrails": {
                "blocked": sum(g["action"] == "blocked" for g in guardrails),
                "redacted": sum(g["action"] == "redacted" for g in guardrails),
                "types": sorted({t for g in guardrails for t in g["types"]}),
            },
            "a2a": {
                "messages": len(a2a),
                "completed": sum(e.data.get("state") == "COMPLETED" for e in a2a),
            },
            "method": "deterministic claim extraction vs tool results and operational store",
        }


def tool_result(name, response):
    """Normalize an ADK function response for the monitor."""
    if not isinstance(response, dict):
        response = {"result": json.loads(json.dumps(response, default=str))}
    return {"name": name, "response": response}

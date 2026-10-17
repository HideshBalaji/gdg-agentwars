"""One-command offline core/recovery/feedback demonstration; never uses live credentials."""

import asyncio
import json
import tempfile
from dataclasses import replace
from pathlib import Path

from ghost_dispatcher.agents.conversations import Conversations
from ghost_dispatcher.config import Settings
from ghost_dispatcher.models.contracts import Feedback, IncidentCreate, Message
from ghost_dispatcher.services.dispatcher import DispatcherService


async def run():
    with tempfile.TemporaryDirectory(prefix="ghost-demo-") as directory:
        service = DispatcherService(
            Settings(
                database=f"{directory}/ghost.sqlite",
                dataset="collected",
                data_dir=str(Path.cwd() / "data"),
            )
        )
        service.bootstrap()
        incident = service.create_incident(
            IncidentCreate(
                shipment_id="SHP-001",
                type="truck_breakdown",
                description="Synthetic TN-07 breakdown near Hosur",
            )
        )
        conversations = Conversations(service)
        try:
            conversation = await conversations.create(incident.id)
            reply = await conversations.send(conversation["id"], Message(text="Plan a rescue"))
            print(f"[SIMULATED] Conversation owner: {reply['active_agent']}")
            service.carriers.health("CAR-001", False)
            result = await service.execute(incident.id)
            print(
                f"[SIMULATED] Primary killed; rescue {result.status} via {result.plan.chosen.carrier_id}"
            )
            # Compare plans against a fresh identical replay snapshot; the outage
            # and first transfer must not confound the feedback demonstration.
            comparison = DispatcherService(
                replace(service.settings, database=f"{directory}/comparison.sqlite")
            )
            comparison.bootstrap()
            before = comparison.create_incident(
                IncidentCreate(
                    shipment_id="SHP-001",
                    type="truck_breakdown",
                    description="Comparable synthetic incident",
                )
            )
            baseline = await comparison.plan(before.id)
            comparison.feedback(
                before.id,
                Feedback(
                    rating="down",
                    reason="Prefer >=5000 INR savings for <=90 minutes delay, within both deadlines",
                    prefer_cheaper_when_slack=True,
                ),
            )
            second = comparison.create_incident(
                IncidentCreate(
                    shipment_id="SHP-001",
                    type="truck_breakdown",
                    description="Same fleet and constraints after feedback",
                )
            )
            learned = await comparison.plan(second.id)
            assert learned.chosen.cost < baseline.chosen.cost
            print(
                json.dumps(
                    {
                        "simulated": True,
                        "baseline_cost": baseline.chosen.cost,
                        "learned_cost": learned.chosen.cost,
                        "currency": learned.chosen.currency,
                        "reason": learned.reason,
                        "healing_events": sum(
                            e.type == "healing" for e in service.store.events(incident.id)
                        ),
                    },
                    indent=2,
                )
            )
        finally:
            await conversations.close()


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()

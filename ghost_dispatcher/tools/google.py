"""Google adapters. Calls are made only by explicit execution in live mode."""

import asyncio
import base64
import hashlib
from datetime import timedelta
from email.message import EmailMessage

import httpx

from ghost_dispatcher.services.store import DomainError


class GoogleTools:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store

    def _token(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        if not self.settings.google_token_file:
            raise DomainError("not_configured", "Set GOOGLE_OAUTH_TOKEN_FILE", 503)
        credentials = Credentials.from_authorized_user_file(self.settings.google_token_file)
        if not credentials.valid:
            credentials.refresh(Request())
        return credentials.token

    async def synchronize(self, incident):
        if self.settings.mode == "offline":
            result = {
                "simulated": True,
                "sheets": "updated",
                "calendar": "reserved",
                "gmail": "notification_simulated",
            }
            self.store.emit(incident.id, "integration.completed", result)
            return result
        if not all(
            (self.settings.sheet_id, self.settings.calendar_id, self.settings.demo_recipient)
        ):
            raise DomainError(
                "not_configured", "Configure Sheet, Calendar and dedicated demo recipient", 503
            )
        token = await asyncio.to_thread(self._token)
        async with httpx.AsyncClient(timeout=20, headers={"Authorization": f"Bearer {token}"}) as c:
            rows = [["Incident", "Shipment", "Status", "Truck", "Carrier", "Cost"]]
            for item in self.store.list("incident"):
                plan = item.get("plan")
                choice = plan["chosen"] if plan else {}
                rows.append(
                    [
                        item["id"],
                        item["shipment_id"],
                        item["status"],
                        choice.get("truck_id", ""),
                        choice.get("carrier_id", ""),
                        choice.get("cost", ""),
                    ]
                )
            fleet = [["Truck", "Status", "Available kg", "Reefer"]]
            fleet += [
                [t["id"], t["status"], t["available_capacity_kg"], t["reefer"]]
                for t in self.store.list("truck")
            ]
            r = await c.post(
                f"https://sheets.googleapis.com/v4/spreadsheets/"
                f"{self.settings.sheet_id}/values:batchUpdate",
                json={
                    "valueInputOption": "RAW",
                    "data": [
                        {"range": "Incidents!A1", "values": rows},
                        {"range": "Fleet!A1", "values": fleet},
                    ],
                },
            )
            r.raise_for_status()
            event_id = hashlib.sha256(incident.id.encode()).hexdigest()
            url = (
                f"https://www.googleapis.com/calendar/v3/calendars/"
                f"{self.settings.calendar_id}/events"
            )
            r = await c.get(f"{url}/{event_id}")
            if r.status_code == 404:
                start = incident.plan.chosen.dock_time
                receiving_minutes = self.store.get("shipment", incident.shipment_id)[
                    "receiving_minutes"
                ]
                if receiving_minutes <= 0:
                    raise DomainError("receiving_duration_missing", "Supply the receiving duration")
                r = await c.post(
                    url,
                    json={
                        "id": event_id,
                        "summary": f"Ghost Dispatcher demo: {incident.shipment_id}",
                        "start": {"dateTime": start.isoformat()},
                        "end": {
                            "dateTime": (start + timedelta(minutes=receiving_minutes)).isoformat()
                        },
                        "description": "Simulated cargo; dedicated demo calendar only",
                    },
                )
                if r.status_code != 409:
                    r.raise_for_status()
            else:
                r.raise_for_status()
            await self._notify(c, incident)
        result = {
            "simulated": False,
            "cargo_simulated": True,
            "sheets": "updated",
            "calendar_event_id": event_id,
            "gmail": "sent",
        }
        self.store.emit(incident.id, "integration.completed", result)
        return result

    async def _notify(self, client, incident):
        key = f"notification-{incident.id}"
        try:
            receipt = self.store.get("google_receipt", key)
            if receipt["status"] == "sent":
                return
        except DomainError:
            receipt = None
        message_id = f"{incident.id}@ghost-dispatcher.demo"
        url = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        if receipt:
            # A prior send may have committed; never repeat it blindly.
            found = await client.get(url, params={"q": f"rfc822msgid:{message_id}"})
            found.raise_for_status()
            if found.json().get("messages"):
                self.store.put("google_receipt", key, {"status": "sent"})
                return
            raise DomainError(
                "notification_uncertain", "Check Gmail before retrying this notification", 503
            )
        message = EmailMessage()
        message["To"] = self.settings.demo_recipient
        message["Subject"] = f"[SIMULATED CARGO] Rescue update {incident.shipment_id}"
        message["Message-ID"] = f"<{message_id}>"
        message.set_content(
            f"Demo incident {incident.id}: load assigned to "
            f"{incident.plan.chosen.truck_id}. No real medical cargo involved."
        )
        self.store.put("google_receipt", key, {"status": "sending"})
        r = await client.post(
            f"{url}/send", json={"raw": base64.urlsafe_b64encode(message.as_bytes()).decode()}
        )
        r.raise_for_status()
        self.store.put("google_receipt", key, {"status": "sent", "id": r.json()["id"]})

import asyncio
from dataclasses import replace

import httpx
import pytest

from ghost_dispatcher.services.store import DomainError
from ghost_dispatcher.tools.google import GoogleTools
from ghost_dispatcher.tools.routing import Router


def test_live_routes_contract_without_external_network(settings, monkeypatch):
    from ghost_dispatcher.models.contracts import Location

    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"routes": [{"distanceMeters": 10000, "duration": "600s"}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw)
    )
    router = Router(replace(settings, mode="live", maps_key="test-only"))
    result = asyncio.run(router.leg(Location(lat=12, lng=77), Location(lat=13, lng=78)))
    assert result == {"km": 10, "minutes": 10, "source": "google_maps_routes"}
    assert requests[0].headers["x-goog-fieldmask"] == "routes.duration,routes.distanceMeters"


def test_google_replays_do_not_duplicate_email_or_calendar(service, incident, monkeypatch):
    record = asyncio.run(service.execute(incident.id))
    calls = []
    calendar_exists = False

    def handler(request):
        nonlocal calendar_exists
        calls.append((request.method, request.url.host, request.url.path))
        if request.url.host == "sheets.googleapis.com":
            return httpx.Response(200, json={})
        if request.url.host == "www.googleapis.com":
            if request.method == "GET":
                return httpx.Response(200 if calendar_exists else 404, json={})
            calendar_exists = True
            return httpx.Response(200, json={"id": "event"})
        return httpx.Response(200, json={"id": "email"})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw)
    )
    monkeypatch.setattr(GoogleTools, "_token", lambda self: "test-only")
    google = GoogleTools(
        replace(
            service.settings,
            mode="live",
            sheet_id="demo-sheet",
            calendar_id="demo-calendar",
            demo_recipient="demo@example.com",
        ),
        service.store,
    )
    assert asyncio.run(google.synchronize(record))["gmail"] == "sent"
    asyncio.run(google.synchronize(record))
    assert (
        sum(method == "POST" and host == "gmail.googleapis.com" for method, host, _ in calls) == 1
    )
    assert sum(method == "POST" and host == "www.googleapis.com" for method, host, _ in calls) == 1


def test_ambiguous_email_does_not_send_twice(service, incident):
    record = asyncio.run(service.execute(incident.id))
    google = GoogleTools(service.settings, service.store)
    sends = []

    def handler(request):
        if request.method == "POST":
            sends.append(request)
            raise httpx.ReadTimeout("Ambiguous send", request=request)
        return httpx.Response(200, json={"messages": []})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(httpx.ReadTimeout):
                await google._notify(client, record)
            with pytest.raises(DomainError, match="Check Gmail"):
                await google._notify(client, record)

    asyncio.run(scenario())
    assert len(sends) == 1

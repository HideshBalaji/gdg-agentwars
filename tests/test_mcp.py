import asyncio
import json
import socket
import threading
import time
from contextlib import contextmanager
from dataclasses import replace

import httpx
import uvicorn
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from ghost_dispatcher.api import create_app as create_api
from mcp_server.server import create_app


@contextmanager
def running(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.02)
        assert server.started
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        assert not thread.is_alive()


def test_real_mcp_and_adk_discovery(settings):
    with running(create_app(settings)) as url:
        assert httpx.post(f"{url}/mcp", json={}).status_code == 401

        async def call():
            async with (
                httpx.AsyncClient(headers={"Authorization": "Bearer ghost-demo"}) as http,
                streamable_http_client(f"{url}/mcp", http_client=http) as (read, write, _),
                ClientSession(read, write) as client,
            ):
                await client.initialize()
                tools = await client.list_tools()
                assert {"get_shipment", "list_trucks_near", "assign_load"} <= {
                    t.name for t in tools.tools
                }
                shipment = await client.call_tool("get_shipment", {"shipment_id": "SHIP-1"})
                assert not shipment.isError
                assert "SHIP-1" in shipment.content[0].text
                nearby = await client.call_tool(
                    "list_trucks_near",
                    {"lat": 12.74, "lng": 77.82, "radius_km": 100, "needs_reefer": True},
                )
                assert not nearby.isError
            toolset = McpToolset(
                connection_params=StreamableHTTPConnectionParams(
                    url=f"{url}/mcp", headers={"Authorization": "Bearer ghost-demo"}
                ),
                tool_filter=["get_shipment"],
            )
            try:
                discovered = await toolset.get_tools()
                assert [tool.name for tool in discovered] == ["get_shipment"]
                result = await discovered[0].run_async(
                    args={"shipment_id": "SHIP-1"}, tool_context=None
                )
                assert "SHIP-1" in str(result)
            finally:
                await toolset.close()

        asyncio.run(call())


def test_mcp_mutations_forward_to_api_and_persist(settings):
    with (
        running(create_api(settings)) as api,
        running(create_app(replace(settings, api_url=api))) as mcp_url,
    ):

        async def scenario():
            async with (
                httpx.AsyncClient(headers={"Authorization": "Bearer ghost-demo"}) as http,
                streamable_http_client(f"{mcp_url}/mcp", http_client=http) as (read, write, _),
                ClientSession(read, write) as client,
            ):
                await client.initialize()
                created = await client.call_tool(
                    "log_incident",
                    {"shipment_id": "SHIP-1", "description": "MCP to HTTP integration"},
                )
                assert not created.isError
                incident_id = json.loads(created.content[0].text)["id"]
                plan = await http.post(f"{api}/api/incidents/{incident_id}/plan")
                assert plan.status_code == 200
                truck_id = plan.json()["chosen"]["truck_id"]
                for _ in range(2):
                    assigned = await client.call_tool(
                        "assign_load", {"incident_id": incident_id, "truck_id": truck_id}
                    )
                    assert not assigned.isError
                    assert json.loads(assigned.content[0].text)["status"] == "resolved"
                events = await http.get(f"{api}/api/incidents/{incident_id}/events")
                assert events.text.count("event: action.completed") == 1

        asyncio.run(scenario())

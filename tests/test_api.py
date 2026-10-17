def new_incident(client):
    response = client.post(
        "/api/incidents",
        json={"shipment_id": "SHIP-1", "type": "truck_breakdown", "description": "Demo failure"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_auth_and_boundary_validation(client):
    assert client.get("/api/fleet", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/api/incidents", json={}).status_code == 422
    assert client.get("/api/incidents/missing").status_code == 404
    assert client.get("/health").json()["mode"] == "offline"


def test_http_flow_and_replayable_events(client):
    incident = new_incident(client)
    assert client.post(f"/api/incidents/{incident}/plan").status_code == 200
    assert client.post("/api/demo/carriers/primary/kill").status_code == 200
    result = client.post(f"/api/incidents/{incident}/execute")
    assert result.status_code == 200
    assert result.json()["status"] == "resolved"
    assert result.json()["actions"]["booking"]["carrier_id"] == "backup"
    events = client.get(f"/api/incidents/{incident}/events").text
    assert "event: healing" in events
    assert "event: incident.resolved" in events
    last_id = max(int(line[4:]) for line in events.splitlines() if line.startswith("id: "))
    assert client.get(f"/api/incidents/{incident}/events?after={last_id}").text == ""


def test_specialists_own_followups_and_transfer_back(client):
    incident = new_incident(client)
    conversation = client.post("/api/conversations", json={"incident_id": incident}).json()["id"]

    def send(text, target=None):
        payload = {"text": text}
        if target:
            payload["target_agent"] = target
        response = client.post(f"/api/conversations/{conversation}/messages", json=payload)
        assert response.status_code == 200
        return response.json()

    assert send("Plan a rescue")["active_agent"] == "route_risk"
    plan_id = client.get(f"/api/incidents/{incident}").json()["plan"]["id"]
    assert send("Why this vehicle?")["active_agent"] == "route_risk"
    assert client.get(f"/api/incidents/{incident}").json()["plan"]["id"] == plan_id
    assert send("Show my current status", "negotiator")["active_agent"] == "negotiator"
    assert send("Back to coordinator")["active_agent"] == "dispatcher"
    history = client.get(f"/api/conversations/{conversation}").json()
    assert len(history["messages"]) == 8
    assert "handover" in client.get(f"/api/incidents/{incident}/events").text


def test_upload_restrictions_and_incident_evidence(client):
    response = client.post(
        "/api/uploads", files={"file": ("x.exe", b"bad", "application/octet-stream")}
    )
    assert response.status_code == 415
    assert (
        client.post("/api/uploads", files={"file": ("x.pdf", b"", "application/pdf")}).status_code
        == 422
    )
    evidence = client.post(
        "/api/uploads", files={"file": ("x.pdf", b"%PDF-demo", "application/pdf")}
    )
    assert evidence.status_code == 201
    assert "path" not in evidence.json()
    response = client.post(
        "/api/incidents",
        json={
            "shipment_id": "SHIP-1",
            "type": "truck_breakdown",
            "description": "Attachment fixture",
            "evidence_ids": [evidence.json()["id"]],
        },
    )
    assert response.status_code == 201


def test_ui_cors_and_contract(client):
    response = client.options(
        "/api/fleet",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "trucks" in client.get("/api/contracts/seed").json()["properties"]

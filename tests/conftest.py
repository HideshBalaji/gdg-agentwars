import pytest
from fastapi.testclient import TestClient

from ghost_dispatcher.api import create_app
from ghost_dispatcher.config import Settings
from ghost_dispatcher.models.contracts import IncidentCreate
from ghost_dispatcher.services.dispatcher import DispatcherService


@pytest.fixture
def settings(tmp_path):
    return Settings(database=str(tmp_path / "ghost.sqlite"))


@pytest.fixture
def service(settings):
    service = DispatcherService(settings)
    service.bootstrap()
    return service


@pytest.fixture
def incident(service):
    return service.create_incident(
        IncidentCreate(
            shipment_id="SHIP-1", type="truck_breakdown", description="Synthetic truck failure"
        )
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        client.headers["Authorization"] = "Bearer ghost-demo"
        yield client

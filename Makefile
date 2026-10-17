PY ?= python3
VENV ?= .venv
BIN = $(VENV)/bin

.PHONY: setup test lint docker-build docker-test api mcp carrier demo clean

setup:  ## Create .venv and install the project with dev tools
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -U pip
	$(BIN)/pip install -e ".[dev]"

test:  ## Run the test suite (no API keys needed)
	$(BIN)/pytest -q

lint:  ## Lint with ruff
	$(BIN)/ruff check ghost_dispatcher mcp_server mock_services tests

api:  ## UI backend, http://127.0.0.1:8000/docs
	$(BIN)/ghost-api

mcp:  ## Authenticated MCP, http://127.0.0.1:8001/mcp
	$(BIN)/ghost-mcp

carrier:  ## Simulated carrier for live-mode HTTP integration
	$(BIN)/uvicorn mock_services.carrier_api:create_app --factory --host 127.0.0.1 --port 8002

demo:  ## Isolated offline ADK, recovery and feedback demonstration
	$(BIN)/ghost-demo

docker-build:  ## Build the container image
	docker compose build

docker-test:  ## Run the test suite inside the container
	docker compose run --rm app

clean:  ## Remove the venv and build/test caches
	rm -rf $(VENV) .pytest_cache .ruff_cache build dist *.egg-info

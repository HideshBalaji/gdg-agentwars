PY ?= python3
VENV ?= .venv
BIN = $(VENV)/bin

.PHONY: setup test lint docker-build docker-test clean

setup:  ## Create .venv and install the project with dev tools
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -U pip
	$(BIN)/pip install -e ".[dev]"

test:  ## Run the test suite (no API keys needed)
	$(BIN)/pytest -q

lint:  ## Lint with ruff
	$(BIN)/ruff check ghost_dispatcher mcp_server mock_services tests

docker-build:  ## Build the container image
	docker compose build

docker-test:  ## Run the test suite inside the container
	docker compose run --rm app

clean:  ## Remove the venv and build/test caches
	rm -rf $(VENV) .pytest_cache .ruff_cache build dist *.egg-info

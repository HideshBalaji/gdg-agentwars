FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY ghost_dispatcher ./ghost_dispatcher
COPY mcp_server ./mcp_server
COPY mock_services ./mock_services
RUN pip install ".[dev]"

COPY data ./data
COPY tests ./tests

CMD ["pytest", "-q"]

"""UI contract: authenticated JSON + evidence uploads + replayable SSE events."""

import asyncio
import hmac
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, Header, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from ghost_dispatcher.agents.conversations import Conversations
from ghost_dispatcher.agents.team import AGENTS
from ghost_dispatcher.config import Settings
from ghost_dispatcher.models.contracts import (
    ChatReply,
    Conversation,
    ConversationCreate,
    Evidence,
    Feedback,
    Incident,
    IncidentCreate,
    Message,
    Plan,
)
from ghost_dispatcher.services.dispatcher import DispatcherService
from ghost_dispatcher.services.store import DomainError


def create_app(settings=None):
    settings = settings or Settings.from_env()
    service = DispatcherService(settings)
    service.bootstrap()
    conversations = Conversations(service)

    @asynccontextmanager
    async def lifespan(app):
        async def sync_worker():
            while True:
                await asyncio.sleep(30)
                await service.retry_sync_jobs()

        worker = asyncio.create_task(sync_worker())
        try:
            yield
        finally:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
            await conversations.close()

    app = FastAPI(title="Ghost Dispatcher API", version="1.0.0", lifespan=lifespan)
    app.state.service = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.origin],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    )

    def authenticate(authorization: str = Header(default="")):
        if not hmac.compare_digest(authorization, f"Bearer {settings.token}"):
            raise DomainError("unauthorized", "Bearer token required", 401)

    protected = [Depends(authenticate)]

    @app.exception_handler(DomainError)
    async def domain_error(request, error):
        return JSONResponse(
            {"code": error.code, "message": error.message}, status_code=error.status
        )

    @app.exception_handler(httpx.HTTPError)
    async def upstream_error(request, error):
        return JSONResponse(
            {
                "code": "upstream_error",
                "message": f"Upstream request failed: {type(error).__name__}",
            },
            status_code=503,
        )

    @app.get("/health")
    def health():
        return {"status": "ok", "mode": settings.mode, "schema_version": 1}

    @app.get("/api/agents", dependencies=protected)
    def agents():
        return {"agents": sorted(AGENTS)}

    @app.get("/api/fleet", dependencies=protected)
    def fleet():
        return service.fleet()

    @app.get("/api/incidents", dependencies=protected, response_model=list[Incident])
    def incidents():
        return service.store.list("incident")

    @app.post("/api/incidents", dependencies=protected, status_code=201, response_model=Incident)
    def create_incident(request: IncidentCreate):
        return service.create_incident(request)

    @app.get("/api/incidents/{incident_id}", dependencies=protected, response_model=Incident)
    def incident(incident_id: str):
        return service.incident(incident_id)

    @app.post("/api/incidents/{incident_id}/plan", dependencies=protected, response_model=Plan)
    async def plan(incident_id: str):
        return await service.plan(incident_id)

    @app.post(
        "/api/incidents/{incident_id}/execute", dependencies=protected, response_model=Incident
    )
    async def execute(incident_id: str):
        return await service.execute(incident_id)

    @app.post("/api/incidents/{incident_id}/feedback", dependencies=protected, status_code=201)
    def feedback(incident_id: str, request: Feedback):
        return service.feedback(incident_id, request)

    @app.get("/api/preferences", dependencies=protected)
    def preferences():
        return service.store.list("preference")

    @app.post("/api/uploads", dependencies=protected, status_code=201, response_model=Evidence)
    async def upload(file: Annotated[UploadFile, File()]):
        allowed = {
            "image/jpeg",
            "image/png",
            "audio/wav",
            "audio/mpeg",
            "audio/mp4",
            "audio/webm",
            "application/pdf",
        }
        if file.content_type not in allowed:
            raise DomainError("unsupported_media", "Use JPEG, PNG, WAV, MP3, M4A, WebM or PDF", 415)
        evidence_id = uuid4().hex
        directory = Path(settings.database).parent / "uploads"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / evidence_id
        size = 0
        try:
            with path.open("wb") as output:
                while chunk := await file.read(64 * 1024):
                    size += len(chunk)
                    if size > 10 * 1024 * 1024:
                        raise DomainError(
                            "upload_too_large", "Maximum evidence size is 10 MiB", 413
                        )
                    output.write(chunk)
            if size == 0:
                raise DomainError("empty_upload", "Evidence cannot be empty", 422)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()
        record = {
            "id": evidence_id,
            "mime_type": file.content_type,
            "size": size,
            "path": str(path),
        }
        service.store.put("evidence", evidence_id, record)
        return {k: v for k, v in record.items() if k != "path"}

    @app.post(
        "/api/conversations", dependencies=protected, status_code=201, response_model=Conversation
    )
    async def create_conversation(request: ConversationCreate):
        return await conversations.create(request.incident_id)

    @app.get(
        "/api/conversations/{conversation_id}", dependencies=protected, response_model=Conversation
    )
    def conversation(conversation_id: str):
        return service.store.get("conversation", conversation_id)

    @app.post(
        "/api/conversations/{conversation_id}/messages",
        dependencies=protected,
        response_model=ChatReply,
    )
    async def send(conversation_id: str, request: Message):
        return await conversations.send(conversation_id, request)

    @app.get("/api/incidents/{incident_id}/events", dependencies=protected)
    async def events(
        incident_id: str,
        after: int = Query(default=0, ge=0),
        follow: bool = False,
        last_event_id: str | None = Header(default=None),
    ):
        service.incident(incident_id)
        if last_event_id:
            try:
                after = max(after, int(last_event_id))
            except ValueError as exc:
                raise DomainError(
                    "invalid_argument", "Last-Event-ID must be an integer", 422
                ) from exc

        async def stream():
            cursor = after
            while True:
                for event in service.store.events(incident_id, cursor):
                    cursor = event.id
                    yield f"id: {event.id}\nevent: {event.type}\ndata: {event.model_dump_json()}\n\n"
                if not follow:
                    break
                yield ": heartbeat\n\n"
                await asyncio.sleep(1)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/demo/carriers/{carrier_id}/{action}", dependencies=protected)
    def fault(carrier_id: str, action: str):
        if action not in {"kill", "revive"}:
            raise DomainError("invalid_argument", "Use kill or revive", 422)
        return service.carriers.health(carrier_id, action == "revive")

    @app.post("/api/demo/reset", dependencies=protected)
    def reset_demo():
        """Re-seed fleet/carriers for a comparable incident; keeps learned preferences."""
        return service.reset_demo()

    @app.get("/api/sync-jobs", dependencies=protected)
    def sync_jobs():
        return service.store.list("sync_job")

    @app.post("/api/sync-jobs/retry", dependencies=protected)
    async def retry_sync():
        return await service.retry_sync_jobs()

    @app.get("/api/contracts/seed", dependencies=protected)
    def seed_contract():
        from ghost_dispatcher.models.contracts import Seed

        return Seed.model_json_schema()

    return app


def main():
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8000)

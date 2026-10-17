"""Guardrails: personal information is refused at entry and redacted before any model,
tool result or reply. The log records only types and counts, never the values."""

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from ghost_dispatcher.guardrails.pii import (
    DlpDetector,
    RegexDetector,
    pdf_text,
    redact_data,
    redact_text,
)
from ghost_dispatcher.services.store import DomainError

GLOBAL_SCOPE = "_system"
_MEDIA_PROMPT = (
    "You are a privacy screen. List the categories of personal information that are visible "
    "or audible in this file: person names, phone numbers, email addresses, home addresses, "
    "government ID numbers, faces or licence plates. Fictional company names, truck IDs such "
    'as TN-07 and shipment IDs such as SHP-001 are not personal. Reply as JSON: {"pii_types": []}'
)


def build_detector(settings):
    if settings.pii_engine == "dlp":
        if not settings.gcp_project:
            raise ValueError("GHOST_PII_ENGINE=dlp requires GOOGLE_CLOUD_PROJECT")
        return DlpDetector(settings.gcp_project)
    return RegexDetector()


class Guardrails:
    def __init__(self, settings, store, detector=None):
        self.settings, self.store = settings, store
        self.detector = detector or build_detector(settings)

    # ---- logging -----------------------------------------------------------------------

    def _record(self, incident_id, surface, action, types):
        entry = {
            "id": uuid4().hex,
            "incident_id": incident_id or GLOBAL_SCOPE,
            "surface": surface,
            "action": action,
            "types": sorted(set(types)),
            "count": len(types),
            "engine": self.detector.name,
            "degraded": getattr(self.detector, "degraded", False),
            "at": datetime.now(UTC).isoformat(),
        }
        self.store.put("guardrail", entry["id"], entry)
        self.store.emit(entry["incident_id"], "guardrail", entry)
        return entry

    def log(self):
        return self.store.list("guardrail")

    # ---- entry points ------------------------------------------------------------------

    def screen_input(self, text, *, surface, incident_id=None):
        """Refuse user-entered personal information; nothing is stored or sent to a model."""
        if not text:
            return
        types = [f.type for f in self.detector.scan(text)]
        if types:
            self._record(incident_id, surface, "blocked", types)
            raise DomainError(
                "pii_blocked",
                "Personal information is not accepted ("
                + ", ".join(sorted(set(types)))
                + "). Remove it and refer to people by ID, e.g. DRV-007 or CUS-001.",
                422,
            )

    def redact(self, value, *, surface, incident_id=None):
        """Redact personal information from text or JSON-like data before it moves on."""
        redacted, types = redact_data(self.detector, value)
        if types:
            self._record(incident_id, surface, "redacted", types)
        return redacted

    def screen_upload(self, path, mime_type):
        """Refuse evidence files that carry personal information.

        PDFs are scanned through their text layer in every mode. In live mode, images and
        audio are screened by Gemini Flash; offline they are marked as not screened."""
        types, method = [], "not_screened_offline"
        if mime_type == "application/pdf":
            types = [f.type for f in self.detector.scan(pdf_text(Path(path).read_bytes()))]
            method = f"pdf_text:{self.detector.name}"
        elif self.settings.mode == "live":
            types, method = self._screen_media(path, mime_type), "gemini_media_screen"
        if types:
            Path(path).unlink(missing_ok=True)
            self._record(None, "upload", "blocked", types)
            raise DomainError(
                "pii_blocked",
                "This file contains personal information ("
                + ", ".join(sorted(set(types)))
                + "). Upload a redacted copy.",
                422,
            )
        return method

    def _screen_media(self, path, mime_type):
        from google import genai
        from google.genai import types

        client = genai.Client()
        response = client.models.generate_content(
            model=self.settings.flash_model,
            contents=[
                types.Part.from_bytes(data=Path(path).read_bytes(), mime_type=mime_type),
                _MEDIA_PROMPT,
            ],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        try:
            found = json.loads(response.text or "{}").get("pii_types", [])
        except json.JSONDecodeError:
            found = ["UNPARSEABLE_SCREEN_RESULT"]
        return [str(item).upper().replace(" ", "_") for item in found]

    # ---- ADK callbacks -----------------------------------------------------------------

    def _incident(self, context):
        return context.state.get("incident_id")

    def before_model(self, callback_context, llm_request):
        """Last line of defence: nothing personal reaches Gemini, even from tool output."""
        types = []
        for content in llm_request.contents or []:
            for part in content.parts or []:
                if part.text:
                    part.text, found = redact_text(self.detector, part.text)
                    types += found
                if part.function_response and part.function_response.response:
                    response, found = redact_data(self.detector, part.function_response.response)
                    part.function_response.response = response
                    types += found
        if types:
            self._record(self._incident(callback_context), "model_input", "redacted", types)

    def after_model(self, callback_context, llm_response):
        """Agents never fetch or repeat personal information back to a user."""
        types = []
        content = llm_response.content
        for part in (content.parts if content else None) or []:
            if part.text:
                part.text, found = redact_text(self.detector, part.text)
                types += found
            if part.function_call and part.function_call.args:
                part.function_call.args, found = redact_data(
                    self.detector, dict(part.function_call.args)
                )
                types += found
        if types:
            self._record(self._incident(callback_context), "model_output", "redacted", types)
            return llm_response
        return None

    def before_tool(self, tool, args, tool_context):
        """Refuse tool calls that would write personal information (e.g. feedback text)."""
        types = []
        for value in (args or {}).values():
            if isinstance(value, str):
                types += [f.type for f in self.detector.scan(value)]
        if types:
            self._record(self._incident(tool_context), f"tool_args:{tool.name}", "blocked", types)
            return {
                "code": "pii_blocked",
                "message": "Tool input contained personal information; refer to people by ID.",
            }
        return None

    def after_tool(self, tool, args, tool_context, tool_response):
        redacted, types = redact_data(self.detector, tool_response)
        if types:
            self._record(
                self._incident(tool_context), f"tool_result:{tool.name}", "redacted", types
            )
            return redacted
        return None

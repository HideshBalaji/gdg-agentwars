"""HTTP PII guardrail: inspects JSON request bodies and redacts JSON responses.

In `GHOST_PII_MODE=block` a request whose JSON contains personal data is rejected
with 422 before any handler runs. In the default `redact` mode the contracts
redact free text on parse (see models/contracts.py) and handlers record a
`guardrail` event. Every JSON response is deep-redacted as a last line of defence.
"""

import json

from ghost_dispatcher.services import guardrails


class PiiGuardMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)

        guardrails.start_collecting()
        headers = dict(scope.get("headers") or [])
        is_json = b"application/json" in headers.get(b"content-type", b"")

        if scope["method"] in {"POST", "PUT", "PATCH"} and is_json:
            body = b""
            while True:
                message = await receive()
                body += message.get("body", b"")
                if not message.get("more_body"):
                    break
            if guardrails.mode() == "block":
                try:
                    payload = json.loads(body or b"null")
                except ValueError:
                    payload = None
                counts = guardrails.Counter()
                guardrails.redact(payload, counts)
                if counts:
                    return await _json(send, 422, {
                        "code": "pii_blocked",
                        "message": "Personal data is not accepted. Remove it and try again.",
                        **guardrails.summary(counts),
                    })
            sent = False

            async def replay():
                nonlocal sent
                if sent:
                    return {"type": "http.request", "body": b"", "more_body": False}
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}

            receive = replay

        start: dict = {}
        chunks: list[bytes] = []

        async def capture(message):
            if message["type"] == "http.response.start":
                ctype = dict(message.get("headers") or []).get(b"content-type", b"")
                if b"application/json" not in ctype:
                    start["passthrough"] = True
                    return await send(message)
                start.update(message)
                return None
            if start.get("passthrough"):
                return await send(message)
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return None
            body = b"".join(chunks)
            try:
                body = json.dumps(guardrails.redact(json.loads(body)), ensure_ascii=False).encode()
            except ValueError:
                pass
            headers = [(k, v) for k, v in start.get("headers", []) if k.lower() != b"content-length"]
            headers.append((b"content-length", str(len(body)).encode()))
            if counts := guardrails.collected():
                headers.append((b"x-pii-redacted", ",".join(f"{k}={v}" for k, v in sorted(counts.items())).encode()))
            await send({"type": "http.response.start", "status": start["status"], "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, capture)


async def _json(send, status, payload):
    body = json.dumps(payload).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})

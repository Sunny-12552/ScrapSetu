"""Structured-ish logging setup with request correlation."""

from __future__ import annotations

import logging
import sys
import uuid

from fastapi import Request


def _safe_stream(stream):  # type: ignore[no-untyped-def]
    """Never let a legacy Windows code page crash logging.

    Dev SMS/notification bodies contain the rupee sign, which cp1252 cannot
    encode.  Fall back to backslash escapes instead of raising inside the
    logging handler (that would otherwise print a traceback per message).
    """
    try:
        stream.reconfigure(errors="backslashreplace")
    except (AttributeError, ValueError, OSError):  # pragma: no cover - platform specific
        pass
    return stream


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(level.upper())
        return
    handler = logging.StreamHandler(_safe_stream(sys.stdout))
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level.upper())
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


async def request_context_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

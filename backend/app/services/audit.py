"""Audit logging for sensitive actions."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.rate_limit import client_ip
from app.core.security import hash_token
from app.models import AuditLog, User


def _safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    return str(value)


def record(
    db: Session,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    reason: str | None = None,
    request: Request | None = None,
) -> AuditLog:
    ip_hash = None
    user_agent = None
    if request is not None:
        ip_hash = hash_token(client_ip(request))[:32]
        user_agent = (request.headers.get("user-agent") or "")[:255]
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_role=actor.role if actor else "system",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=_safe(before),
        after=_safe(after),
        reason=reason,
        ip_hash=ip_hash,
        user_agent=user_agent,
    )
    db.add(entry)
    return entry

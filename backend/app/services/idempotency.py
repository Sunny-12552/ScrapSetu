"""Idempotency for critical mutations.

Store the response for a caller-supplied ``Idempotency-Key`` so retries after a
network failure cannot double-accept an offer, double-pay or double-complete.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.models import IdempotencyKey


def _hash_payload(payload: Any) -> str:
    raw = json.dumps(payload, default=str, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def get_stored(db: Session, user_id: str, key: str, endpoint: str) -> dict | None:
    row = db.execute(
        select(IdempotencyKey).where(
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.key == key,
            IdempotencyKey.endpoint == endpoint,
        )
    ).scalar_one_or_none()
    if not row:
        return None
    return {"status": row.response_status, "body": row.response_body}


def validate_key(key: str | None) -> str | None:
    if key is None:
        return None
    key = key.strip()
    if not (8 <= len(key) <= 120) or not key.replace("-", "").replace("_", "").isalnum():
        raise ValidationError("Idempotency-Key must be 8-120 letters, digits, - or _.")
    return key


def store(
    db: Session,
    *,
    user_id: str,
    key: str,
    endpoint: str,
    request_payload: Any,
    response_status: int,
    response_body: dict,
) -> None:
    row = IdempotencyKey(
        user_id=user_id,
        key=key,
        endpoint=endpoint,
        request_hash=_hash_payload(request_payload),
        response_status=response_status,
        response_body=response_body,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def check_key(request: Request) -> str | None:
    return validate_key(request.headers.get("Idempotency-Key"))


def replay_or_conflict(
    db: Session,
    *,
    user_id: str,
    key: str | None,
    endpoint: str,
    payload: Any,
) -> dict | None:
    if not key:
        return None
    stored = get_stored(db, user_id, key, endpoint)
    if not stored:
        return None
    if stored.get("status", 200) >= 400:
        raise ConflictError("This request was already processed and failed.")
    return stored

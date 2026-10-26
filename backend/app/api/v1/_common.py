"""Helpers shared by API routers for serialization and idempotency."""

from __future__ import annotations

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.models import Booking, User
from app.services import idempotency
from app.services.bookings import booking_evidence
from app.services.serializers import booking_read


def serialize_booking(db: Session, booking: Booking, role: str) -> dict:
    return jsonable_encoder(
        booking_read(
            booking, viewer_role=role, evidence=booking_evidence(db, booking)
        )
    )


def replay(
    db: Session,
    request: Request,
    user: User,
    *,
    endpoint: str,
    payload: dict,
    key: str | None,
) -> JSONResponse | None:
    if not key:
        return None
    stored = idempotency.replay_or_conflict(
        db, user_id=user.id, key=key, endpoint=endpoint, payload=payload
    )
    if not stored:
        return None
    return JSONResponse(status_code=stored["status"], content=stored["body"])


def remember(
    db: Session,
    user: User,
    *,
    key: str | None,
    endpoint: str,
    payload: dict,
    body: dict,
    status: int = 200,
) -> None:
    if not key:
        return
    idempotency.store(
        db,
        user_id=user.id,
        key=key,
        endpoint=endpoint,
        request_payload=payload,
        response_status=status,
        response_body=body,
    )

"""Authorized file streaming. Objects are never exposed without a permission check."""

from __future__ import annotations

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ForbiddenError, NotFoundError
from app.integrations.storage import read_object
from app.models import (
    Booking,
    DealerProfile,
    Dispute,
    ScrapImage,
    ScrapRequest,
)

router = APIRouter(prefix="/files", tags=["files"])

MIME_BY_EXT = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "pdf": "application/pdf",
}


def _not_found() -> NotFoundError:
    return NotFoundError("File not found.")


def _authorize(db, user, key: str) -> None:
    if user.role == "admin":
        return
    parts = key.split("/")
    if len(parts) < 2:
        raise _not_found()
    prefix, owner_id = parts[0], parts[1]

    if prefix == "request-images":
        request = db.get(ScrapRequest, owner_id)
        if not request:
            raise _not_found()
        if request.customer_id == user.id:
            return
        if user.role == "dealer":
            dealer = db.execute(
                select(DealerProfile).where(DealerProfile.user_id == user.id)
            ).scalar_one_or_none()
            if not dealer:
                raise ForbiddenError("You do not have access to this file.")
            booking = request.booking
            if booking and booking.dealer_id == dealer.id:
                return
            if request.status == "open" and dealer.status == "approved":
                from app.services.matching import dealer_eligible_for_request

                eligible, _ = dealer_eligible_for_request(db, dealer, request)
                if eligible:
                    return
        raise ForbiddenError("You do not have access to this file.")

    if prefix == "dealer-docs":
        dealer = db.get(DealerProfile, owner_id)
        if not dealer:
            raise _not_found()
        if dealer.user_id == user.id:
            return
        raise ForbiddenError("You do not have access to this document.")

    if prefix in {"booking-evidence", "payment-evidence"}:
        booking = db.get(Booking, owner_id)
        if not booking:
            raise _not_found()
        if user.role == "customer" and booking.customer_id == user.id:
            return
        if user.role == "dealer" and booking.dealer.user_id == user.id:
            return
        raise ForbiddenError("You do not have access to this file.")

    if prefix == "dispute-evidence":
        dispute = db.get(Dispute, owner_id)
        if not dispute:
            raise _not_found()
        booking = dispute.booking
        if user.role == "customer" and booking.customer_id == user.id:
            return
        if user.role == "dealer" and booking.dealer.user_id == user.id:
            return
        raise ForbiddenError("You do not have access to this file.")

    raise _not_found()


@router.get("/{key:path}")
def stream_file(key: str, db: DbSession, user: CurrentUser):
    _authorize(db, user, key)
    try:
        data = read_object(key)
    except FileNotFoundError as exc:
        raise _not_found() from exc
    extension = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    media_type = MIME_BY_EXT.get(extension, "application/octet-stream")
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )

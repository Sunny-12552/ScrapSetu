"""Booking details and the complete pickup → settlement → payment workflow."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession, Paging
from app.api.v1._common import remember, replay, serialize_booking
from app.core.config import settings
from app.core.errors import ForbiddenError, NotFoundError, ValidationError
from app.models import (
    DealerProfile,
    PaymentRecord,
    PaymentStatus,
    ScrapRequest,
    SettlementStatus,
    User,
)
from app.schemas import (
    BookingRead,
    CancelBookingBody,
    ConfirmPaymentBody,
    ConfirmSettlementBody,
    DisputeCreateBody,
    RecordPaymentBody,
    RecordWeighingBody,
    SubmitSettlementBody,
)
from app.services import bookings as booking_service
from app.services import idempotency
from app.services.serializers import booking_summary

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _assert_access(booking, user: User) -> None:
    booking_service.assert_party(booking, user)


def _respond(db, booking, user: User, *, endpoint: str, key: str | None, payload: dict):
    body = serialize_booking(db, booking, user.role)
    remember(db, user, key=key, endpoint=endpoint, payload=payload, body=body)
    return JSONResponse(status_code=200, content=body)


@router.get("")
def list_bookings(
    db: DbSession,
    user: CurrentUser,
    paging: Paging,
    status: str | None = Query(default=None),
):
    stmt = select(booking_service.Booking).options(
        selectinload(booking_service.Booking.dealer),
        selectinload(booking_service.Booking.request).selectinload(ScrapRequest.city),
        selectinload(booking_service.Booking.settlements),
    )
    if user.role == "customer":
        stmt = stmt.where(booking_service.Booking.customer_id == user.id)
    elif user.role == "dealer":
        dealer = booking_service.get_dealer_profile(db, user)
        stmt = stmt.where(booking_service.Booking.dealer_id == dealer.id)
    if status:
        stmt = stmt.where(booking_service.Booking.status == status)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(booking_service.Booking.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    return {
        "items": [booking_summary(b) for b in rows],
        "total": total,
        "page": paging.page,
        "page_size": paging.page_size,
        "pages": max(1, (total + paging.page_size - 1) // paging.page_size),
    }


@router.get("/{booking_id}", response_model=BookingRead)
def get_booking(booking_id: str, db: DbSession, user: CurrentUser):
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    return serialize_booking(db, booking, user.role)


@router.post("/{booking_id}/confirm")
def confirm_job(booking_id: str, request: Request, db: DbSession, user: CurrentUser):
    key = idempotency.check_key(request)
    existing = replay(db, request, user, endpoint="booking.confirm", payload={"id": booking_id}, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.confirm_job(db, booking, user)
    return _respond(db, booking, user, endpoint="booking.confirm", key=key, payload={"id": booking_id})


@router.post("/{booking_id}/start-pickup")
def start_pickup(booking_id: str, request: Request, db: DbSession, user: CurrentUser):
    key = idempotency.check_key(request)
    existing = replay(db, request, user, endpoint="booking.start_pickup", payload={"id": booking_id}, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.start_pickup(db, booking, user)
    return _respond(db, booking, user, endpoint="booking.start_pickup", key=key, payload={"id": booking_id})


@router.post("/{booking_id}/record-weighing")
def record_weighing(
    booking_id: str,
    payload: RecordWeighingBody,
    request: Request,
    db: DbSession,
    user: CurrentUser,
):
    key = idempotency.check_key(request)
    replay_payload = {"id": booking_id, "items": [i.model_dump(mode="json") for i in payload.items]}
    existing = replay(db, request, user, endpoint="booking.record_weighing", payload=replay_payload, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.record_weighing(db, booking, user, payload)
    return _respond(db, booking, user, endpoint="booking.record_weighing", key=key, payload=replay_payload)


@router.post("/{booking_id}/submit-settlement")
def submit_settlement(
    booking_id: str,
    payload: SubmitSettlementBody,
    request: Request,
    db: DbSession,
    user: CurrentUser,
):
    key = idempotency.check_key(request)
    replay_payload = payload.model_dump(mode="json")
    replay_payload["id"] = booking_id
    existing = replay(db, request, user, endpoint="booking.submit_settlement", payload=replay_payload, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.submit_settlement(db, booking, user, payload, http_request=request)
    return _respond(db, booking, user, endpoint="booking.submit_settlement", key=key, payload=replay_payload)


@router.post("/{booking_id}/confirm-settlement")
def confirm_settlement(
    booking_id: str,
    payload: ConfirmSettlementBody,
    request: Request,
    db: DbSession,
    user: CurrentUser,
):
    key = idempotency.check_key(request)
    replay_payload = {"id": booking_id, **payload.model_dump(mode="json")}
    existing = replay(db, request, user, endpoint="booking.confirm_settlement", payload=replay_payload, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.confirm_settlement(
        db, booking, user, approve=payload.approve, note=payload.note
    )
    return _respond(db, booking, user, endpoint="booking.confirm_settlement", key=key, payload=replay_payload)


@router.post("/{booking_id}/record-payment")
def record_payment(
    booking_id: str,
    payload: RecordPaymentBody,
    request: Request,
    db: DbSession,
    user: CurrentUser,
):
    key = idempotency.check_key(request)
    replay_payload = {"id": booking_id, **payload.model_dump(mode="json")}
    existing = replay(db, request, user, endpoint="booking.record_payment", payload=replay_payload, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.record_payment(
        db,
        booking,
        user,
        method=payload.method,
        amount=payload.amount,
        upi_reference=payload.upi_reference,
        payer_note=payload.payer_note,
    )
    return _respond(db, booking, user, endpoint="booking.record_payment", key=key, payload=replay_payload)


@router.post("/{booking_id}/confirm-payment")
def confirm_payment(
    booking_id: str,
    payload: ConfirmPaymentBody,
    request: Request,
    db: DbSession,
    user: CurrentUser,
):
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    payment_id = payload.payment_id
    if not payment_id:
        recorded = [p for p in booking.payments if p.status == PaymentStatus.RECORDED]
        if not recorded:
            raise NotFoundError("No recorded payment is awaiting confirmation.")
        payment_id = recorded[-1].id
    key = idempotency.check_key(request)
    replay_payload = {"id": booking_id, "payment_id": payment_id}
    existing = replay(db, request, user, endpoint="booking.confirm_payment", payload=replay_payload, key=key)
    if existing:
        return existing
    booking = booking_service.confirm_payment(db, booking, user, payment_id)
    return _respond(db, booking, user, endpoint="booking.confirm_payment", key=key, payload=replay_payload)


@router.post("/{booking_id}/cancel")
def cancel_booking(
    booking_id: str,
    payload: CancelBookingBody,
    request: Request,
    db: DbSession,
    user: CurrentUser,
):
    key = idempotency.check_key(request)
    replay_payload = {"id": booking_id, **payload.model_dump(mode="json")}
    existing = replay(db, request, user, endpoint="booking.cancel", payload=replay_payload, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.cancel_booking(db, booking, user, reason=payload.reason)
    return _respond(db, booking, user, endpoint="booking.cancel", key=key, payload=replay_payload)


@router.post("/{booking_id}/dispute")
def raise_dispute(
    booking_id: str,
    payload: DisputeCreateBody,
    request: Request,
    db: DbSession,
    user: CurrentUser,
):
    key = idempotency.check_key(request)
    replay_payload = {"id": booking_id, **payload.model_dump(mode="json")}
    existing = replay(db, request, user, endpoint="booking.dispute", payload=replay_payload, key=key)
    if existing:
        return existing
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    booking = booking_service.raise_dispute(
        db, booking, user, category=payload.category, description=payload.description
    )
    return _respond(db, booking, user, endpoint="booking.dispute", key=key, payload=replay_payload)


@router.post("/{booking_id}/evidence")
async def upload_evidence(
    booking_id: str,
    db: DbSession,
    user: CurrentUser,
    evidence_type: str = Form(...),
    note: str | None = Form(default=None),
    file: UploadFile = File(...),
):
    if evidence_type not in {"weighing", "payment", "other"}:
        raise ValidationError("Evidence type must be weighing, payment or other.")
    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1024)
    from app.integrations.storage import save_document

    stored = save_document(
        "booking-evidence",
        booking.id,
        data,
        file.content_type or "application/octet-stream",
        file.filename or "evidence",
    )
    booking = booking_service.attach_evidence(
        db,
        booking,
        user,
        evidence_type=evidence_type,
        stored_key=stored.key,
        file_name=file.filename or "evidence",
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
        note=note,
    )
    return _respond(db, booking, user, endpoint="booking.evidence", key=None, payload={"id": booking_id})


@router.get("/{booking_id}/dispute")
def booking_dispute(booking_id: str, db: DbSession, user: CurrentUser):
    from app.models import Dispute

    booking = booking_service.load_booking(db, booking_id)
    _assert_access(booking, user)
    rows = (
        db.execute(
            select(Dispute)
            .where(Dispute.booking_id == booking.id)
            .order_by(Dispute.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": d.id,
            "category": d.category,
            "description": d.description,
            "status": d.status,
            "raised_by_role": d.raised_by_role,
            "resolution": d.resolution,
            "created_at": d.created_at,
            "resolved_at": d.resolved_at,
        }
        for d in rows
    ]

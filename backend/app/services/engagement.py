"""Reviews, support tickets, notifications helpers, and account deletion."""

from __future__ import annotations

import hashlib

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.security import generate_reference
from app.core.time import local_tz, utcnow
from app.models import (
    Booking,
    BookingStatus,
    Review,
    ReviewStatus,
    Role,
    ScrapRequest,
    SupportTicket,
    User,
    UserStatus,
)
from app.schemas import ReviewCreate, SupportTicketCreate
from app.services import audit, notifications
from app.services.admin import recalc_dealer_rating


def create_review(db: Session, customer: User, payload: ReviewCreate) -> Review:
    booking = db.get(Booking, payload.booking_id)
    if not booking:
        raise NotFoundError("Booking not found.")
    if booking.customer_id != customer.id:
        raise ForbiddenError("You can only review your own bookings.")
    if booking.status != BookingStatus.COMPLETED:
        raise ConflictError("Reviews are available after a completed collection.")
    existing = db.execute(
        select(Review).where(Review.booking_id == booking.id)
    ).scalar_one_or_none()
    if existing:
        raise ConflictError("You have already reviewed this collection.")
    if not (1 <= payload.rating <= 5):
        raise ValidationError("Rating must be between 1 and 5.")
    review = Review(
        booking_id=booking.id,
        customer_id=customer.id,
        dealer_id=booking.dealer_id,
        rating=payload.rating,
        comment=(payload.comment or "").strip() or None,
        status=ReviewStatus.PUBLISHED,
    )
    db.add(review)
    db.flush()
    recalc_dealer_rating(db, booking.dealer_id)
    notifications.notify(
        db,
        user_id=booking.dealer.user_id,
        type="review_received",
        title="New customer review",
        body=f"{booking.reference}: {payload.rating}/5. {payload.comment or ''}".strip(),
        data={"booking_id": booking.id, "review_id": review.id},
        dedupe_key=f"review:{review.id}",
        send_sms=False,
    )
    audit.record(
        db, actor=customer, action="review.created", entity_type="review",
        entity_id=review.id, after={"rating": payload.rating, "booking_id": booking.id},
    )
    db.commit()
    return review


def dealer_reviews(db: Session, dealer_id: str, *, limit: int = 50) -> list[Review]:
    return (
        db.execute(
            select(Review)
            .where(
                Review.dealer_id == dealer_id,
                Review.status == ReviewStatus.PUBLISHED.value,
            )
            .order_by(Review.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )


def create_support_ticket(
    db: Session, user: User, payload: SupportTicketCreate
) -> SupportTicket:
    reference = generate_reference("SST")
    ticket = SupportTicket(
        reference=reference,
        user_id=user.id,
        subject=payload.subject,
        message=payload.message,
        category=payload.category,
        status="open",
        priority="high" if payload.category == "payment" else "normal",
    )
    db.add(ticket)
    audit.record(
        db, actor=user, action="support.ticket_created", entity_type="support_ticket",
        entity_id=ticket.id, after={"category": payload.category},
    )
    db.commit()
    return ticket


def user_support_tickets(db: Session, user_id: str, *, limit: int = 50):
    return (
        db.execute(
            select(SupportTicket)
            .where(SupportTicket.user_id == user_id)
            .order_by(SupportTicket.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )


def _anonymised_phone(phone: str) -> str:
    digest = hashlib.sha256(f"deleted:{phone}".encode()).hexdigest()
    digits = "".join(ch for ch in digest if ch.isdigit())[:9]
    return f"+919{digits.zfill(9)}"


def delete_customer_account(
    db: Session, user: User, *, reason: str | None, http_request: Request | None = None
) -> None:
    if user.role != Role.CUSTOMER:
        raise ForbiddenError("Only customer accounts can be deleted from this endpoint.")
    active = db.execute(
        select(func.count(Booking.id)).where(
            Booking.customer_id == user.id,
            Booking.status.in_(
                [
                    BookingStatus.OFFER_SELECTED.value,
                    BookingStatus.BOOKING_CONFIRMED.value,
                    BookingStatus.PICKUP_IN_PROGRESS.value,
                    BookingStatus.WEIGHING_RECORDED.value,
                    BookingStatus.SETTLEMENT_PENDING.value,
                    BookingStatus.DISPUTED.value,
                ]
            ),
        )
    ).scalar_one()
    if active:
        raise ConflictError(
            "You have an active pickup or settlement. Complete or cancel it before deleting your account."
        )
    before = {"status": user.status, "phone": user.phone}
    user.status = UserStatus.DELETED
    user.deleted_at = utcnow()
    user.phone = _anonymised_phone(user.phone)
    if user.profile:
        user.profile.full_name = "Deleted user"
        user.profile.email = None
    from app.models import AuthSession, CustomerAddress

    for address in db.execute(
        select(CustomerAddress).where(CustomerAddress.customer_id == user.id)
    ).scalars():
        address.is_active = False
        address.line1 = "Removed for privacy"
        address.line2 = None
        address.contact_name = "Removed"
    for session in db.execute(
        select(AuthSession).where(
            AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)
        )
    ).scalars():
        session.revoked_at = utcnow()
    for request in db.execute(
        select(ScrapRequest).where(
            ScrapRequest.customer_id == user.id,
            ScrapRequest.status == "draft",
        )
    ).scalars():
        request.deleted_at = utcnow()
        request.status = "cancelled"
    audit.record(
        db, actor=user, action="customer.account_deleted", entity_type="user",
        entity_id=user.id, before=before,
        after={"status": "deleted", "retention": "financial records retained"},
        reason=reason, request=http_request,
    )
    db.commit()

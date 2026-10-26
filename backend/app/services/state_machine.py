"""Explicit booking state machine with actor authorization and guards.

Every transition goes through :func:`transition` so history, audit entries and
notifications cannot be bypassed by an endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.constants import CANCELLATION_CUTOFF_HOURS, window_bounds_utc
from app.core.errors import ConflictError, ForbiddenError, ValidationError
from app.core.time import utcnow
from app.models import (
    Booking,
    BookingStatus,
    BookingStatusHistory,
    PaymentStatus,
    Role,
    SettlementStatus,
)

CUSTOMER = Role.CUSTOMER.value
DEALER = Role.DEALER.value
ADMIN = Role.ADMIN.value
SYSTEM = "system"


@dataclass(frozen=True)
class TransitionRule:
    allowed_actors: frozenset[str]
    label: str


TRANSITIONS: dict[tuple[str, str], TransitionRule] = {
    (BookingStatus.OFFER_SELECTED, BookingStatus.BOOKING_CONFIRMED): TransitionRule(
        frozenset({DEALER, ADMIN}), "Dealer accepts the assigned job"
    ),
    (BookingStatus.OFFER_SELECTED, BookingStatus.CANCELLED): TransitionRule(
        frozenset({CUSTOMER, DEALER, ADMIN}), "Booking cancelled before confirmation"
    ),
    (BookingStatus.BOOKING_CONFIRMED, BookingStatus.PICKUP_IN_PROGRESS): TransitionRule(
        frozenset({DEALER, ADMIN}), "Dealer starts the pickup"
    ),
    (BookingStatus.BOOKING_CONFIRMED, BookingStatus.CANCELLED): TransitionRule(
        frozenset({CUSTOMER, DEALER, ADMIN}), "Booking cancelled before pickup"
    ),
    (BookingStatus.PICKUP_IN_PROGRESS, BookingStatus.WEIGHING_RECORDED): TransitionRule(
        frozenset({DEALER, ADMIN}), "Dealer records weighed quantities"
    ),
    (BookingStatus.PICKUP_IN_PROGRESS, BookingStatus.CANCELLED): TransitionRule(
        frozenset({ADMIN}), "Admin cancels a pickup in progress"
    ),
    (BookingStatus.WEIGHING_RECORDED, BookingStatus.SETTLEMENT_PENDING): TransitionRule(
        frozenset({DEALER, ADMIN}), "Dealer submits the settlement for confirmation"
    ),
    (BookingStatus.WEIGHING_RECORDED, BookingStatus.DISPUTED): TransitionRule(
        frozenset({CUSTOMER, ADMIN}), "Customer disputes the weighing"
    ),
    (BookingStatus.SETTLEMENT_PENDING, BookingStatus.DISPUTED): TransitionRule(
        frozenset({CUSTOMER, DEALER, ADMIN}), "Settlement disputed"
    ),
    (BookingStatus.SETTLEMENT_PENDING, BookingStatus.COMPLETED): TransitionRule(
        frozenset({CUSTOMER, ADMIN, SYSTEM}), "Settlement confirmed and payment confirmed"
    ),
    (BookingStatus.SETTLEMENT_PENDING, BookingStatus.CANCELLED): TransitionRule(
        frozenset({ADMIN}), "Admin cancels a pending settlement"
    ),
    (BookingStatus.SETTLEMENT_PENDING, BookingStatus.FAILED): TransitionRule(
        frozenset({ADMIN}), "Admin marks the job as failed"
    ),
    (BookingStatus.DISPUTED, BookingStatus.SETTLEMENT_PENDING): TransitionRule(
        frozenset({ADMIN}), "Dispute resolved and settlement reopened"
    ),
    (BookingStatus.DISPUTED, BookingStatus.COMPLETED): TransitionRule(
        frozenset({ADMIN}), "Dispute resolved and job completed"
    ),
    (BookingStatus.DISPUTED, BookingStatus.CANCELLED): TransitionRule(
        frozenset({ADMIN}), "Dispute resolved by cancelling the booking"
    ),
}

ACTIVE_STATUSES = {
    BookingStatus.OFFER_SELECTED,
    BookingStatus.BOOKING_CONFIRMED,
    BookingStatus.PICKUP_IN_PROGRESS,
    BookingStatus.WEIGHING_RECORDED,
    BookingStatus.SETTLEMENT_PENDING,
    BookingStatus.DISPUTED,
}

TERMINAL_STATUSES = {BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.FAILED}


def get_rule(from_status: str, to_status: str) -> TransitionRule | None:
    return TRANSITIONS.get((from_status, to_status))


def can_transition(from_status: str, to_status: str, actor_role: str) -> bool:
    rule = get_rule(from_status, to_status)
    return bool(rule and actor_role in rule.allowed_actors)


def assert_transition_allowed(
    booking: Booking, to_status: str, actor_role: str
) -> TransitionRule:
    if booking.status == to_status:
        raise ConflictError(f"Booking is already {to_status.replace('_', ' ')}.")
    rule = get_rule(booking.status, to_status)
    if rule is None:
        raise ConflictError(
            f"Cannot move a booking from {booking.status} to {to_status}."
        )
    if actor_role not in rule.allowed_actors:
        raise ForbiddenError("You are not allowed to perform this booking action.")
    if booking.status in TERMINAL_STATUSES:
        raise ConflictError("This booking is closed and can no longer change.")
    return rule


def assert_cancellation_window(booking: Booking, actor_role: str) -> None:
    """Customers can self-cancel up to 4 hours before the pickup window starts."""
    if actor_role != CUSTOMER:
        return
    if booking.status not in (BookingStatus.OFFER_SELECTED, BookingStatus.BOOKING_CONFIRMED):
        raise ForbiddenError(
            "This booking can no longer be cancelled online. Please raise a dispute or contact support."
        )
    start, _ = window_bounds_utc(booking.scheduled_date, booking.time_window)
    if utcnow() > start - timedelta(hours=CANCELLATION_CUTOFF_HOURS):
        raise ForbiddenError(
            f"Online cancellation closes {CANCELLATION_CUTOFF_HOURS} hours before the pickup window. "
            "Please contact support."
        )


def completion_requirements(booking: Booking) -> dict[str, bool]:
    settlements = booking.settlements
    latest = settlements[-1] if settlements else None
    settlement_ok = bool(
        latest
        and latest.status
        in {
            SettlementStatus.CUSTOMER_CONFIRMED,
            SettlementStatus.PAID,
            SettlementStatus.COMPLETED,
        }
    )
    confirmed_payments = [
        p for p in booking.payments if p.status == PaymentStatus.CONFIRMED
    ]
    paid_amount = sum((p.amount for p in confirmed_payments), start=0)
    payment_ok = bool(latest and paid_amount >= latest.final_payout)
    return {"settlement_confirmed": settlement_ok, "payment_confirmed": payment_ok}


def transition(
    db: Session,
    booking: Booking,
    to_status: str,
    *,
    actor_id: str | None,
    actor_role: str,
    reason: str | None = None,
    metadata: dict | None = None,
) -> BookingStatusHistory:
    assert_transition_allowed(booking, to_status, actor_role)
    if to_status == BookingStatus.COMPLETED:
        requirements = completion_requirements(booking)
        if not all(requirements.values()):
            raise ConflictError(
                "The booking cannot be completed until the customer confirms the "
                "settlement and the payment is confirmed.",
                details=requirements,
            )
    if to_status == BookingStatus.BOOKING_CONFIRMED:
        booking.confirmed_at = utcnow()
    if to_status == BookingStatus.PICKUP_IN_PROGRESS:
        booking.pickup_started_at = utcnow()
    if to_status == BookingStatus.WEIGHING_RECORDED:
        booking.weighing_recorded_at = utcnow()
    if to_status == BookingStatus.SETTLEMENT_PENDING:
        booking.settlement_submitted_at = utcnow()
    if to_status == BookingStatus.COMPLETED:
        booking.completed_at = utcnow()
    if to_status == BookingStatus.CANCELLED:
        booking.cancelled_at = utcnow()
        booking.cancelled_by = actor_id
        booking.cancellation_reason = reason

    history = BookingStatusHistory(
        booking_id=booking.id,
        from_status=booking.status,
        to_status=to_status,
        actor_id=actor_id,
        actor_role=actor_role,
        reason=reason,
        event_metadata=metadata or {},
    )
    db.add(history)
    booking.status = to_status
    booking.version += 1
    db.flush()
    return history


def next_actions(booking: Booking, role: str) -> list[str]:
    actions: list[str] = []
    status = booking.status
    if role == DEALER:
        if status == BookingStatus.OFFER_SELECTED:
            actions += ["confirm_job", "cancel"]
        elif status == BookingStatus.BOOKING_CONFIRMED:
            actions += ["start_pickup", "cancel"]
        elif status == BookingStatus.PICKUP_IN_PROGRESS:
            actions += ["record_weighing"]
        elif status == BookingStatus.WEIGHING_RECORDED:
            actions += ["submit_settlement"]
        elif status == BookingStatus.SETTLEMENT_PENDING:
            actions.append("record_payment")
            if not booking.payments or all(
                p.status != PaymentStatus.CONFIRMED for p in booking.payments
            ):
                actions.append("await_customer_confirmation")
            actions.append("raise_dispute")
        elif status == BookingStatus.DISPUTED:
            actions.append("respond_to_dispute")
    elif role == CUSTOMER:
        if status in (BookingStatus.OFFER_SELECTED, BookingStatus.BOOKING_CONFIRMED):
            actions.append("cancel")
        if status in (BookingStatus.WEIGHING_RECORDED, BookingStatus.SETTLEMENT_PENDING):
            latest = booking.settlements[-1] if booking.settlements else None
            if latest and latest.status == SettlementStatus.SUBMITTED:
                actions += ["confirm_settlement", "dispute"]
            if booking.payments and any(
                p.status == PaymentStatus.RECORDED for p in booking.payments
            ):
                actions.append("confirm_payment")
            if status == BookingStatus.WEIGHING_RECORDED:
                actions.append("dispute")
        if status == BookingStatus.DISPUTED:
            actions += ["view_dispute"]
        if status == BookingStatus.COMPLETED and not booking.review:
            actions.append("review")
    elif role == ADMIN:
        if status == BookingStatus.DISPUTED:
            actions.append("resolve_dispute")
        actions.append("inspect")
    return list(dict.fromkeys(actions))

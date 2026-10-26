"""Booking workflow: confirm, pickup, weighing, settlement, payment, disputes."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.constants import local_today
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.time import utcnow
from app.models import (
    Booking,
    BookingEvidence,
    BookingStatus,
    BookingStatusHistory,
    DealerOffer,
    DealerOfferItem,
    DealerProfile,
    Dispute,
    DisputeStatus,
    MeasuredScrapItem,
    PaymentEvent,
    PaymentMethod,
    PaymentRecord,
    PaymentStatus,
    PickupRecord,
    RequestStatus,
    Review,
    ScrapRequest,
    ScrapRequestItem,
    Settlement,
    SettlementItem,
    SettlementStatus,
    User,
)
from app.schemas import RecordWeighingBody, SubmitSettlementBody
from app.services import audit, notifications
from app.services.fees import customer_platform_fee
from app.services.serializers import decimal_str
from app.services.settlement import (
    CalculationError,
    calculate_payout,
    line_total,
    money,
    q2,
    q3,
)
from app.services.state_machine import (
    assert_cancellation_window,
    completion_requirements,
    transition,
)


def booking_query():
    return select(Booking).options(
        selectinload(Booking.request)
        .selectinload(ScrapRequest.items)
        .selectinload(ScrapRequestItem.category),
        selectinload(Booking.request).selectinload(ScrapRequest.booking),
        selectinload(Booking.request).selectinload(ScrapRequest.customer),
        selectinload(Booking.customer).selectinload(User.profile),
        selectinload(Booking.dealer).selectinload(DealerProfile.city),
        selectinload(Booking.dealer).selectinload(DealerProfile.user),
        selectinload(Booking.dealer).selectinload(DealerProfile.service_areas),
        selectinload(Booking.offer)
        .selectinload(DealerOffer.items)
        .selectinload(DealerOfferItem.category),
        selectinload(Booking.snapshot),
        selectinload(Booking.history),
        selectinload(Booking.pickups),
        selectinload(Booking.measured_items).selectinload(MeasuredScrapItem.category),
        selectinload(Booking.settlements)
        .selectinload(Settlement.items)
        .selectinload(SettlementItem.category),
        selectinload(Booking.settlements).selectinload(Settlement.payments),
        selectinload(Booking.payments),
        selectinload(Booking.review),
        selectinload(Booking.disputes),
    )


def load_booking(db: Session, booking_id: str) -> Booking:
    booking = db.execute(
        booking_query()
        .where(Booking.id == booking_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if not booking:
        raise NotFoundError("Booking not found.")
    return booking


def get_dealer_profile(db: Session, user: User) -> DealerProfile:
    profile = db.execute(
        select(DealerProfile).where(DealerProfile.user_id == user.id)
    ).scalar_one_or_none()
    if not profile:
        raise ForbiddenError("Complete your dealer application first.")
    return profile


def assert_party(booking: Booking, user: User) -> None:
    if user.role == "admin":
        return
    if user.role == "customer" and booking.customer_id == user.id:
        return
    if user.role == "dealer" and booking.dealer.user_id == user.id:
        return
    raise ForbiddenError("You do not have access to this booking.")


def latest_settlement(booking: Booking) -> Settlement | None:
    return booking.settlements[-1] if booking.settlements else None


def _snapshot_items(booking: Booking) -> dict[str, dict]:
    payload = booking.snapshot.payload if booking.snapshot else {}
    return {item["category_id"]: item for item in payload.get("items", [])}


def _evidence(db: Session, booking_id: str) -> list[dict]:
    rows = (
        db.execute(
            select(BookingEvidence)
            .where(BookingEvidence.booking_id == booking_id)
            .order_by(BookingEvidence.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": row.id,
            "evidence_type": row.evidence_type,
            "file_name": row.file_name,
            "mime_type": row.mime_type,
            "size_bytes": row.size_bytes,
            "url": f"/api/v1/files/{row.file_key}",
            "note": row.note,
            "created_at": row.created_at,
        }
        for row in rows
    ]


def _release_request_for_reassignment(db: Session, booking: Booking) -> None:
    request = booking.request
    if request.status in (RequestStatus.OFFER_SELECTED, RequestStatus.EXPIRED):
        if request.preferred_date >= local_today():
            request.status = RequestStatus.OPEN
            request.published_at = utcnow()
            request.expires_at = utcnow() + timedelta(days=3)
        else:
            request.status = RequestStatus.EXPIRED


def maybe_complete(
    db: Session, booking: Booking, *, actor_id: str | None, actor_role: str
) -> bool:
    if booking.status != BookingStatus.SETTLEMENT_PENDING:
        return False
    requirements = completion_requirements(booking)
    if not all(requirements.values()):
        return False
    settlement = latest_settlement(booking)
    if settlement is None:
        return False
    if settlement.status not in (
        SettlementStatus.CUSTOMER_CONFIRMED,
        SettlementStatus.PAID,
        SettlementStatus.COMPLETED,
    ):
        return False

    transition(
        db,
        booking,
        BookingStatus.COMPLETED,
        actor_id=actor_id,
        actor_role=actor_role,
        reason="Customer confirmed the settlement and payment.",
        metadata=requirements,
    )
    settlement.status = SettlementStatus.COMPLETED
    settlement.paid_at = settlement.paid_at or utcnow()
    settlement.completed_at = utcnow()
    booking.request.status = RequestStatus.COMPLETED
    dealer = booking.dealer
    dealer.completed_jobs += 1

    notifications.notify(
        db,
        user_id=booking.customer_id,
        type="booking_completed",
        title="Collection completed",
        body=(
            f"{booking.reference} is complete. Final payout ₹{settlement.final_payout} "
            "recorded. You can now rate the dealer."
        ),
        data={"booking_id": booking.id},
        dedupe_key=f"booking-completed-customer:{booking.id}",
    )
    notifications.notify(
        db,
        user_id=dealer.user_id,
        type="booking_completed",
        title="Job completed",
        body=f"{booking.reference} is complete. Payout ₹{settlement.final_payout} recorded.",
        data={"booking_id": booking.id},
        dedupe_key=f"booking-completed-dealer:{booking.id}",
    )
    audit.record(
        db,
        actor=None,
        action="booking.completed",
        entity_type="booking",
        entity_id=booking.id,
        after={
            "final_payout": str(settlement.final_payout),
            "settlement_id": settlement.id,
            "payment_confirmed": True,
        },
    )
    return True


def confirm_job(db: Session, booking: Booking, user: User) -> Booking:
    dealer = get_dealer_profile(db, user)
    if booking.dealer_id != dealer.id:
        raise ForbiddenError("This job is assigned to another dealer.")
    transition(
        db,
        booking,
        BookingStatus.BOOKING_CONFIRMED,
        actor_id=user.id,
        actor_role="dealer",
        reason="Dealer accepted the job.",
    )
    notifications.notify(
        db,
        user_id=booking.customer_id,
        type="pickup_scheduled",
        title="Pickup confirmed",
        body=(
            f"{dealer.business_name} confirmed {booking.reference} for "
            f"{booking.scheduled_date} ({booking.time_window})."
        ),
        data={"booking_id": booking.id},
        dedupe_key=f"job-confirmed:{booking.id}",
    )
    audit.record(
        db, actor=user, action="booking.confirmed", entity_type="booking",
        entity_id=booking.id, after={"status": booking.status},
    )
    db.commit()
    return load_booking(db, booking.id)


def start_pickup(db: Session, booking: Booking, user: User) -> Booking:
    dealer = get_dealer_profile(db, user)
    if booking.dealer_id != dealer.id:
        raise ForbiddenError("This job is assigned to another dealer.")
    transition(
        db,
        booking,
        BookingStatus.PICKUP_IN_PROGRESS,
        actor_id=user.id,
        actor_role="dealer",
        reason="Dealer started the pickup.",
    )
    db.add(
        PickupRecord(
            booking_id=booking.id,
            dealer_id=dealer.id,
            started_at=utcnow(),
        )
    )
    notifications.notify(
        db,
        user_id=booking.customer_id,
        type="pickup_started",
        title="Pickup started",
        body=f"{dealer.business_name} has started the pickup for {booking.reference}.",
        data={"booking_id": booking.id},
        dedupe_key=f"pickup-started:{booking.id}",
    )
    audit.record(
        db, actor=user, action="booking.pickup_started", entity_type="booking",
        entity_id=booking.id,
    )
    db.commit()
    return load_booking(db, booking.id)


def _weight(value: Decimal) -> Decimal:
    try:
        decimal_value = money(value)
    except (InvalidOperation, CalculationError) as exc:
        raise ValidationError("Enter a valid weight.") from exc
    if decimal_value < 0:
        raise ValidationError("Weight cannot be negative.")
    exponent = decimal_value.as_tuple().exponent
    if exponent < -3:
        raise ValidationError("Weights are recorded to a maximum of 3 decimal places (grams).")
    return q3(decimal_value)


def record_weighing(
    db: Session, booking: Booking, user: User, payload: RecordWeighingBody
) -> Booking:
    dealer = get_dealer_profile(db, user)
    if booking.dealer_id != dealer.id:
        raise ForbiddenError("This job is assigned to another dealer.")
    if booking.status != BookingStatus.PICKUP_IN_PROGRESS:
        raise ConflictError("Start the pickup before recording weights.")

    accepted = _snapshot_items(booking)
    incoming = {item.category_id: item for item in payload.items}
    if set(incoming) != set(accepted):
        raise ValidationError(
            "Record a weight for every material in the accepted quote (use 0 if absent)."
        )

    measured = {item.category_id: item for item in booking.measured_items}
    for category_id, line in incoming.items():
        weight = _weight(line.actual_weight_kg)
        rate = money(accepted[category_id]["rate_per_kg"])
        row = measured.get(category_id)
        if row is None:
            row = MeasuredScrapItem(
                booking_id=booking.id,
                category_id=category_id,
                actual_weight_kg=weight,
                rate_per_kg=rate,
                line_total=line_total(weight, rate),
                recorded_by=user.id,
            )
            db.add(row)
            booking.measured_items.append(row)
        else:
            row.actual_weight_kg = weight
            row.rate_per_kg = rate
            row.line_total = line_total(weight, rate)
            row.recorded_by = user.id

    if payload.notes:
        pickup = booking.pickups[0] if booking.pickups else None
        if pickup:
            pickup.notes = payload.notes
    transition(
        db,
        booking,
        BookingStatus.WEIGHING_RECORDED,
        actor_id=user.id,
        actor_role="dealer",
        reason="Actual weights recorded.",
        metadata={
            "items": len(incoming),
            "total_weight_kg": str(
                sum((item.actual_weight_kg for item in incoming.values()), Decimal("0"))
            ),
        },
    )
    notifications.notify(
        db,
        user_id=booking.customer_id,
        type="weighing_recorded",
        title="Material weighed",
        body=(
            f"{dealer.business_name} recorded the weights for {booking.reference}. "
            "The settlement will be shared for your approval."
        ),
        data={"booking_id": booking.id},
        dedupe_key=f"weighing-recorded:{booking.id}",
    )
    audit.record(
        db, actor=user, action="booking.weighing_recorded", entity_type="booking",
        entity_id=booking.id, after={"items": len(incoming)},
    )
    db.commit()
    return load_booking(db, booking.id)


def submit_settlement(
    db: Session,
    booking: Booking,
    user: User,
    payload: SubmitSettlementBody,
    *,
    http_request: Request | None = None,
) -> Booking:
    dealer = get_dealer_profile(db, user)
    if booking.dealer_id != dealer.id:
        raise ForbiddenError("This job is assigned to another dealer.")
    if booking.status != BookingStatus.WEIGHING_RECORDED:
        raise ConflictError(
            "Settlements can only be submitted once the weighing is recorded."
        )
    accepted = _snapshot_items(booking)
    incoming = {item.category_id: item for item in payload.items}
    if set(incoming) != set(accepted):
        raise ValidationError(
            "Every material in the accepted quote must appear in the settlement."
        )

    measured = {item.category_id: item for item in booking.measured_items}
    if not measured:
        raise ConflictError("Record the weighed quantities first.")

    changes: list[dict] = []
    lines: list[dict] = []
    payout_inputs: list[tuple[Decimal, Decimal]] = []
    for category_id, line in incoming.items():
        accepted_row = accepted[category_id]
        accepted_rate = money(accepted_row["rate_per_kg"])
        final_rate = (
            money(line.final_rate_per_kg)
            if line.final_rate_per_kg is not None
            else accepted_rate
        )
        weight = _weight(line.actual_weight_kg)
        measured_row = measured.get(category_id)
        if measured_row is None:
            raise ConflictError(
                "The settlement weights do not match the recorded weighing. "
                "Update the weighing instead of changing weights here."
            )
        if q3(measured_row.actual_weight_kg) != weight:
            raise ConflictError(
                "The settlement weights do not match the recorded weighing. "
                "Re-record the weighing if the measurements changed."
            )
        rate_changed = final_rate != accepted_rate
        if rate_changed and not (line.change_reason or "").strip():
            raise ValidationError(
                "A reason is required when the final rate differs from the accepted rate."
            )
        if rate_changed:
            changes.append(
                {
                    "category_id": category_id,
                    "category_name": accepted_row.get("category_name"),
                    "accepted_rate": str(accepted_rate),
                    "final_rate": str(final_rate),
                    "reason": line.change_reason,
                }
            )
        payout_inputs.append((weight, final_rate))
        lines.append(
            {
                "category_id": category_id,
                "category_name": accepted_row.get("category_name"),
                "weight_kg": str(weight),
                "accepted_rate": str(accepted_rate),
                "final_rate": str(final_rate),
                "line_total": str(line_total(weight, final_rate)),
                "rate_changed": rate_changed,
                "change_reason": line.change_reason,
            }
        )

    try:
        platform_fee = customer_platform_fee(
            db,
            city_id=booking.request.city_id,
            gross=sum(
                (line_total(weight, rate) for weight, rate in payout_inputs),
                Decimal("0"),
            ),
            on=local_today(),
        )
        payout = calculate_payout(
            payout_inputs,
            deductions=payload.deductions,
            adjustments=Decimal("0"),
            platform_fee=platform_fee,
        )
    except CalculationError as exc:
        raise ValidationError(str(exc)) from exc

    version = len(booking.settlements) + 1
    settlement = Settlement(
        booking_id=booking.id,
        version=version,
        snapshot_id=booking.snapshot_id,
        status=SettlementStatus.SUBMITTED,
        gross_amount=payout.gross,
        deductions=payout.deductions,
        adjustments=payout.adjustments,
        platform_fee=payout.platform_fee,
        final_payout=payout.final_payout,
        deduction_reason=payload.deduction_reason,
        notes=payload.notes,
        submitted_by=user.id,
        submitted_at=utcnow(),
        calculation={
            "policy": {
                "weight_unit": "kg",
                "weight_precision": 3,
                "money_rounding": "ROUND_HALF_UP",
                "money_scale": 2,
            },
            "formula": "sum(round(weight_kg * final_rate, 2)) - deductions - platform_fee + adjustments",
            "snapshot_id": booking.snapshot_id,
            "accepted_quote_total": str(booking.accepted_payout),
            "lines": lines,
            "gross": str(payout.gross),
            "deductions": str(payout.deductions),
            "platform_fee": str(payout.platform_fee),
            "adjustments": str(payout.adjustments),
            "final_payout": str(payout.final_payout),
            "changes": changes,
            "consent_required": bool(changes),
            "generated_at": utcnow().isoformat(),
            "warnings": payout.warnings,
        },
    )
    db.add(settlement)
    db.flush()

    for line, (weight, final_rate) in zip(lines, payout_inputs, strict=True):
        accepted_rate = money(line["accepted_rate"])
        db.add(
            SettlementItem(
                settlement_id=settlement.id,
                category_id=line["category_id"],
                actual_weight_kg=weight,
                accepted_rate_per_kg=accepted_rate,
                final_rate_per_kg=final_rate,
                line_total=line_total(weight, final_rate),
                rate_changed=line["rate_changed"],
                change_reason=line["change_reason"],
                customer_consent_required=line["rate_changed"],
            )
        )

    transition(
        db,
        booking,
        BookingStatus.SETTLEMENT_PENDING,
        actor_id=user.id,
        actor_role="dealer",
        reason="Dealer submitted the final settlement.",
        metadata={
            "settlement_id": settlement.id,
            "final_payout": str(settlement.final_payout),
            "changes": len(changes),
        },
    )
    notifications.notify(
        db,
        user_id=booking.customer_id,
        type="settlement_submitted",
        title="Final payout ready for your review",
        body=(
            f"{booking.reference}: final payout ₹{settlement.final_payout}. "
            "Review the line-by-line breakdown and confirm or raise a dispute."
        ),
        data={"booking_id": booking.id, "settlement_id": settlement.id},
        dedupe_key=f"settlement-submitted:{settlement.id}",
    )
    audit.record(
        db,
        actor=user,
        action="settlement.submitted",
        entity_type="settlement",
        entity_id=settlement.id,
        after={
            "booking_id": booking.id,
            "version": version,
            "final_payout": str(settlement.final_payout),
            "changes": changes,
        },
        request=http_request,
    )
    db.commit()
    return load_booking(db, booking.id)


def confirm_settlement(
    db: Session,
    booking: Booking,
    user: User,
    *,
    approve: bool,
    note: str | None,
) -> Booking:
    if user.role != "customer" or booking.customer_id != user.id:
        raise ForbiddenError("Only the customer can confirm this settlement.")
    settlement = latest_settlement(booking)
    if not settlement:
        raise ConflictError("There is no settlement to confirm.")
    if settlement.status in (
        SettlementStatus.CUSTOMER_CONFIRMED,
        SettlementStatus.PAID,
        SettlementStatus.COMPLETED,
    ):
        return load_booking(db, booking.id)
    if booking.status != BookingStatus.SETTLEMENT_PENDING:
        raise ConflictError("The settlement is not waiting for confirmation.")
    if settlement.status != SettlementStatus.SUBMITTED:
        raise ConflictError("This settlement has already been reviewed.")

    if not approve:
        if not (note or "").strip():
            raise ValidationError("Tell us what is wrong so the dispute can be investigated.")
        return _create_dispute(
            db,
            booking,
            user,
            category="weight",
            description=note.strip(),
            settlement=settlement,
        )

    now = utcnow()
    settlement.status = SettlementStatus.CUSTOMER_CONFIRMED
    settlement.customer_confirmed_at = now
    for item in settlement.items:
        if item.customer_consent_required:
            item.customer_consent = "approved"
    notifications.notify(
        db,
        user_id=booking.dealer.user_id,
        type="settlement_confirmed",
        title="Customer confirmed the settlement",
        body=(
            f"{booking.reference}: ₹{settlement.final_payout} confirmed by the customer. "
            "Record the payment handover with a reference."
        ),
        data={"booking_id": booking.id},
        dedupe_key=f"settlement-confirmed:{settlement.id}",
    )
    audit.record(
        db,
        actor=user,
        action="settlement.confirmed",
        entity_type="settlement",
        entity_id=settlement.id,
        after={"final_payout": str(settlement.final_payout)},
    )
    db.flush()
    completed = maybe_complete(db, booking, actor_id=user.id, actor_role="customer")
    db.commit()
    return load_booking(db, booking.id)


def record_payment(
    db: Session,
    booking: Booking,
    user: User,
    *,
    method: str,
    amount: Decimal | None,
    upi_reference: str | None,
    payer_note: str | None,
) -> Booking:
    dealer = get_dealer_profile(db, user)
    if booking.dealer_id != dealer.id:
        raise ForbiddenError("This job is assigned to another dealer.")
    if booking.status != BookingStatus.SETTLEMENT_PENDING:
        raise ConflictError("Payment can only be recorded after the settlement is submitted.")
    settlement = latest_settlement(booking)
    if not settlement or settlement.status not in (
        SettlementStatus.SUBMITTED,
        SettlementStatus.CUSTOMER_CONFIRMED,
    ):
        raise ConflictError("The settlement is not ready for payment.")

    existing = [
        p
        for p in booking.payments
        if p.status in (PaymentStatus.RECORDED, PaymentStatus.CONFIRMED)
    ]
    if existing:
        raise ConflictError(
            "A payment is already recorded for this booking. "
            "Ask the customer to confirm it, or raise a dispute."
        )
    final_amount = q2(amount if amount is not None else settlement.final_payout)
    if final_amount != q2(settlement.final_payout):
        raise ValidationError(
            f"Payment must equal the final payout of ₹{settlement.final_payout}. "
            "Partial or extra payments are not supported in this MVP."
        )
    if method not in (PaymentMethod.CASH.value, PaymentMethod.UPI.value):
        raise ValidationError("Choose cash or UPI.")
    if method == PaymentMethod.UPI.value and not (upi_reference or "").strip():
        raise ValidationError("Enter the UPI transaction reference.")

    payment = PaymentRecord(
        booking_id=booking.id,
        settlement_id=settlement.id,
        method=method,
        amount=final_amount,
        status=PaymentStatus.RECORDED,
        upi_reference=upi_reference.strip() if upi_reference else None,
        payer_note=payer_note,
        recorded_by=user.id,
        recorded_at=utcnow(),
    )
    db.add(payment)
    db.flush()
    db.add(
        PaymentEvent(
            payment_id=payment.id,
            event_type="recorded_externally",
            payload={
                "method": method,
                "amount": str(final_amount),
                "gateway_verified": False,
            },
            created_by=user.id,
        )
    )
    notifications.notify(
        db,
        user_id=booking.customer_id,
        type="payment_recorded",
        title="Payment recorded - please confirm",
        body=(
            f"{dealer.business_name} recorded a {method.upper()} payment of "
            f"₹{final_amount} for {booking.reference}. Confirm only after you receive it."
        ),
        data={"booking_id": booking.id, "payment_id": payment.id},
        dedupe_key=f"payment-recorded:{payment.id}",
    )
    audit.record(
        db,
        actor=user,
        action="payment.recorded",
        entity_type="payment",
        entity_id=payment.id,
        after={
            "booking_id": booking.id,
            "method": method,
            "amount": str(final_amount),
            "gateway_verified": False,
        },
    )
    db.commit()
    return load_booking(db, booking.id)


def confirm_payment(db: Session, booking: Booking, user: User, payment_id: str) -> Booking:
    if user.role != "customer" or booking.customer_id != user.id:
        raise ForbiddenError("Only the customer can confirm receipt of payment.")
    payment = db.get(PaymentRecord, payment_id)
    if not payment or payment.booking_id != booking.id:
        raise NotFoundError("Payment record not found.")
    if payment.status == PaymentStatus.CONFIRMED:
        return load_booking(db, booking.id)
    if payment.status != PaymentStatus.RECORDED:
        raise ConflictError("This payment cannot be confirmed.")
    if booking.status not in (BookingStatus.SETTLEMENT_PENDING, BookingStatus.DISPUTED):
        raise ConflictError("This booking is not awaiting a payment confirmation.")
    now = utcnow()
    payment.status = PaymentStatus.CONFIRMED
    payment.customer_confirmed_at = now
    payment.verified_at = now  # customer-confirmed, not gateway-verified
    db.add(
        PaymentEvent(
            payment_id=payment.id,
            event_type="customer_confirmed",
            payload={"gateway_verified": False, "confirmed_by": user.id},
            created_by=user.id,
        )
    )
    audit.record(
        db,
        actor=user,
        action="payment.confirmed_by_customer",
        entity_type="payment",
        entity_id=payment.id,
        after={"amount": str(payment.amount), "gateway_verified": False},
    )
    notifications.notify(
        db,
        user_id=booking.dealer.user_id,
        type="payment_confirmed",
        title="Customer confirmed payment",
        body=f"{booking.reference}: the customer confirmed receiving ₹{payment.amount}.",
        data={"booking_id": booking.id},
        dedupe_key=f"payment-confirmed:{payment.id}",
    )
    db.flush()
    maybe_complete(db, booking, actor_id=user.id, actor_role="customer")
    db.commit()
    return load_booking(db, booking.id)


def cancel_booking(
    db: Session,
    booking: Booking,
    user: User,
    *,
    reason: str,
) -> Booking:
    assert_party(booking, user)
    actor_role = user.role
    assert_cancellation_window(booking, actor_role)
    previous_status = booking.status
    was_confirmed = booking.status in (
        BookingStatus.BOOKING_CONFIRMED,
        BookingStatus.PICKUP_IN_PROGRESS,
    )
    transition(
        db,
        booking,
        BookingStatus.CANCELLED,
        actor_id=user.id,
        actor_role=actor_role,
        reason=reason,
    )
    if actor_role == "dealer" and was_confirmed:
        booking.dealer.cancelled_jobs += 1
    _release_request_for_reassignment(db, booking)
    other_user_id = (
        booking.dealer.user_id if actor_role == "customer" else booking.customer_id
    )
    notifications.notify(
        db,
        user_id=other_user_id,
        type="booking_cancelled",
        title="Booking cancelled",
        body=f"{booking.reference} was cancelled. Reason: {reason}",
        data={"booking_id": booking.id},
        dedupe_key=f"booking-cancelled:{booking.id}:{other_user_id}",
    )
    audit.record(
        db,
        actor=user,
        action="booking.cancelled",
        entity_type="booking",
        entity_id=booking.id,
        before={"status": previous_status},
        after={"status": booking.status, "cancelled_by": user.id, "reason": reason},
        reason=reason,
    )
    db.commit()
    return load_booking(db, booking.id)


def _create_dispute(
    db: Session,
    booking: Booking,
    user: User,
    *,
    category: str,
    description: str,
    settlement: Settlement | None = None,
) -> Booking:
    open_exists = next(
        (d for d in booking.disputes if d.status in (DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW)),
        None,
    )
    if open_exists:
        raise ConflictError("There is already an open dispute for this booking.")
    dispute = Dispute(
        booking_id=booking.id,
        settlement_id=settlement.id if settlement else None,
        raised_by=user.id,
        raised_by_role=user.role,
        category=category,
        description=description,
        status=DisputeStatus.OPEN,
    )
    db.add(dispute)
    db.flush()
    if settlement and settlement.status != SettlementStatus.DISPUTED:
        settlement.status = SettlementStatus.DISPUTED
        settlement.disputed_at = utcnow()
    if booking.status != BookingStatus.DISPUTED:
        transition(
            db,
            booking,
            BookingStatus.DISPUTED,
            actor_id=user.id,
            actor_role=user.role,
            reason=f"Dispute raised: {category}",
            metadata={"dispute_id": dispute.id},
        )
    counterparty = (
        booking.dealer.user_id if user.role == "customer" else booking.customer_id
    )
    notifications.notify(
        db,
        user_id=counterparty,
        type="dispute_opened",
        title="A dispute was raised",
        body=(
            f"{booking.reference}: {category.replace('_', ' ')} dispute. "
            "ScrapSetu support will review the evidence."
        ),
        data={"booking_id": booking.id, "dispute_id": dispute.id},
        dedupe_key=f"dispute-opened:{dispute.id}:{counterparty}",
    )
    audit.record(
        db,
        actor=user,
        action="dispute.created",
        entity_type="dispute",
        entity_id=dispute.id,
        after={"booking_id": booking.id, "category": category},
    )
    db.commit()
    return load_booking(db, booking.id)


def raise_dispute(
    db: Session,
    booking: Booking,
    user: User,
    *,
    category: str,
    description: str,
) -> Booking:
    assert_party(booking, user)
    if booking.status not in (
        BookingStatus.WEIGHING_RECORDED,
        BookingStatus.SETTLEMENT_PENDING,
        BookingStatus.COMPLETED,
    ):
        raise ConflictError("A dispute can only be raised after the material is weighed.")
    settlement = latest_settlement(booking)
    return _create_dispute(
        db, booking, user, category=category, description=description, settlement=settlement
    )


def attach_evidence(
    db: Session,
    booking: Booking,
    user: User,
    *,
    evidence_type: str,
    stored_key: str,
    file_name: str,
    mime_type: str,
    size_bytes: int,
    note: str | None,
) -> Booking:
    assert_party(booking, user)
    if user.role == "customer" and evidence_type == "weighing":
        raise ForbiddenError("Only the assigned dealer can upload weighing evidence.")
    db.add(
        BookingEvidence(
            booking_id=booking.id,
            uploaded_by=user.id,
            evidence_type=evidence_type,
            file_key=stored_key,
            file_name=file_name[:255],
            mime_type=mime_type,
            size_bytes=size_bytes,
            note=note,
        )
    )
    audit.record(
        db,
        actor=user,
        action="booking.evidence_uploaded",
        entity_type="booking",
        entity_id=booking.id,
        after={"type": evidence_type, "file": file_name},
    )
    db.commit()
    return load_booking(db, booking.id)


def booking_evidence(db: Session, booking: Booking) -> list[dict]:
    return _evidence(db, booking.id)


def customer_transactions(
    db: Session, customer_id: str, *, limit: int = 100
) -> list[dict]:
    rows = (
        db.execute(
            select(Booking)
            .where(Booking.customer_id == customer_id)
            .order_by(Booking.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    result = []
    for booking in rows:
        settlement = latest_settlement(booking)
        payment = booking.payments[-1] if booking.payments else None
        result.append(
            {
                "booking_id": booking.id,
                "reference": booking.reference,
                "status": booking.status,
                "completed_at": booking.completed_at,
                "dealer_name": booking.dealer.business_name if booking.dealer else None,
                "locality": booking.request.locality if booking.request else None,
                "quoted_payout": decimal_str(booking.accepted_payout),
                "final_payout": decimal_str(settlement.final_payout) if settlement else None,
                "payment_method": payment.method if payment else None,
                "payment_status": payment.status if payment else None,
                "materials": [
                    item.category.name
                    for item in booking.request.items
                    if item.category
                ]
                if booking.request
                else [],
            }
        )
    return result

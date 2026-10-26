"""Administrative operations: metrics, moderation, disputes, and exports."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.time import utcnow
from app.models import (
    AuditLog,
    Booking,
    BookingStatus,
    DealerOffer,
    DealerProfile,
    DealerServiceArea,
    Dispute,
    DisputeStatus,
    MaterialCategory,
    MaterialPriceReference,
    OfferStatus,
    PaymentEvent,
    PaymentRecord,
    PaymentStatus,
    PlatformFeeRule,
    RequestStatus,
    Review,
    ReviewStatus,
    Role,
    ScrapRequest,
    Settlement,
    SettlementItem,
    SettlementStatus,
    SupportTicket,
    TicketStatus,
    User,
    UserProfile,
    UserStatus,
)
from app.schemas import ResolveDisputeBody
from app.services import audit, notifications
from app.services.settlement import money, q2
from app.services.state_machine import transition

COMPLETED_SETTLEMENT_STATUSES = {
    SettlementStatus.COMPLETED.value,
    SettlementStatus.PAID.value,
}


def _count(db: Session, stmt) -> int:
    return int(db.execute(stmt).scalar_one() or 0)


def dashboard(db: Session) -> dict:
    now = utcnow()
    since_30 = now - timedelta(days=30)
    since_90 = now - timedelta(days=90)

    customers = _count(
        db,
        select(func.count(User.id)).where(
            User.role == Role.CUSTOMER, User.status != UserStatus.DELETED
        ),
    )
    dealers_verified = _count(
        db, select(func.count(DealerProfile.id)).where(DealerProfile.status == "approved")
    )
    dealers_pending = _count(
        db, select(func.count(DealerProfile.id)).where(DealerProfile.status == "submitted")
    )
    new_requests = _count(
        db,
        select(func.count(ScrapRequest.id)).where(ScrapRequest.created_at >= since_30),
    )
    offers_received = _count(
        db,
        select(func.count(DealerOffer.id)).where(DealerOffer.created_at >= since_30),
    )
    bookings_in_progress = _count(
        db,
        select(func.count(Booking.id)).where(
            Booking.status.in_(
                [
                    BookingStatus.OFFER_SELECTED.value,
                    BookingStatus.BOOKING_CONFIRMED.value,
                    BookingStatus.PICKUP_IN_PROGRESS.value,
                    BookingStatus.WEIGHING_RECORDED.value,
                    BookingStatus.SETTLEMENT_PENDING.value,
                ]
            )
        ),
    )
    completed_collections = _count(
        db,
        select(func.count(Booking.id)).where(Booking.status == BookingStatus.COMPLETED.value),
    )
    gross_value = db.execute(
        select(func.coalesce(func.sum(Settlement.final_payout), 0)).where(
            Settlement.status.in_(COMPLETED_SETTLEMENT_STATUSES)
        )
    ).scalar_one()
    platform_revenue = db.execute(
        select(func.coalesce(func.sum(Settlement.platform_fee), 0)).where(
            Settlement.status.in_(COMPLETED_SETTLEMENT_STATUSES)
        )
    ).scalar_one()
    payouts_recorded = db.execute(
        select(func.coalesce(func.sum(PaymentRecord.amount), 0)).where(
            PaymentRecord.status == PaymentStatus.CONFIRMED.value
        )
    ).scalar_one()

    closed_90 = _count(
        db,
        select(func.count(Booking.id)).where(
            Booking.created_at >= since_90,
            Booking.status.in_(
                [
                    BookingStatus.COMPLETED.value,
                    BookingStatus.CANCELLED.value,
                    BookingStatus.FAILED.value,
                ]
            ),
        ),
    )
    cancelled_90 = _count(
        db,
        select(func.count(Booking.id)).where(
            Booking.created_at >= since_90,
            Booking.status == BookingStatus.CANCELLED.value,
        ),
    )
    disputed_90 = _count(
        db,
        select(func.count(func.distinct(Dispute.booking_id))).where(
            Dispute.created_at >= since_90
        ),
    )
    cancellation_rate = (
        q2(Decimal(cancelled_90) / Decimal(closed_90) * Decimal("100"))
        if closed_90
        else Decimal("0.00")
    )
    dispute_rate = (
        q2(Decimal(disputed_90) / Decimal(closed_90) * Decimal("100"))
        if closed_90
        else Decimal("0.00")
    )

    category_rows = db.execute(
        select(
            MaterialCategory.name,
            func.coalesce(func.sum(SettlementItem.actual_weight_kg), 0),
            func.coalesce(func.sum(SettlementItem.line_total), 0),
            func.count(func.distinct(Settlement.booking_id)),
        )
        .join(SettlementItem, SettlementItem.category_id == MaterialCategory.id)
        .join(Settlement, Settlement.id == SettlementItem.settlement_id)
        .where(Settlement.status.in_(COMPLETED_SETTLEMENT_STATUSES))
        .group_by(MaterialCategory.id, MaterialCategory.name)
        .order_by(func.sum(SettlementItem.line_total).desc())
    ).all()

    from app.models import City

    city_rows = db.execute(
        select(
            City.name,
            func.count(Booking.id),
            func.coalesce(func.sum(Settlement.final_payout), 0),
        )
        .join(ScrapRequest, ScrapRequest.city_id == City.id)
        .join(Booking, Booking.request_id == ScrapRequest.id)
        .outerjoin(Settlement, Settlement.booking_id == Booking.id)
        .group_by(City.id, City.name)
        .order_by(func.count(Booking.id).desc())
    ).all()

    open_disputes = _count(
        db,
        select(func.count(Dispute.id)).where(
            Dispute.status.in_([DisputeStatus.OPEN.value, DisputeStatus.UNDER_REVIEW.value])
        ),
    )
    open_tickets = _count(
        db,
        select(func.count(SupportTicket.id)).where(
            SupportTicket.status.in_([TicketStatus.OPEN.value, TicketStatus.IN_PROGRESS.value])
        ),
    )

    return {
        "customers": customers,
        "dealers_verified": dealers_verified,
        "dealers_pending": dealers_pending,
        "new_requests": new_requests,
        "offers_received": offers_received,
        "bookings_in_progress": bookings_in_progress,
        "completed_collections": completed_collections,
        "gross_transaction_value": str(q2(money(gross_value))),
        "platform_revenue": str(q2(money(platform_revenue))),
        "payouts_recorded": str(q2(money(payouts_recorded))),
        "cancellation_rate": cancellation_rate,
        "dispute_rate": dispute_rate,
        "pending_dealer_verifications": dealers_pending,
        "open_disputes": open_disputes,
        "open_support_tickets": open_tickets,
        "category_volume": [
            {
                "category": row[0],
                "weight_kg": str(row[1]),
                "value": str(q2(money(row[2]))),
                "bookings": int(row[3]),
            }
            for row in category_rows
        ],
        "city_activity": [
            {
                "city": row[0],
                "bookings": int(row[1]),
                "value": str(q2(money(row[2]))),
            }
            for row in city_rows
        ],
        "definitions": {
            "new_requests": "Scrap requests created in the last 30 days.",
            "offers_received": "Dealer offers created in the last 30 days.",
            "gross_transaction_value": "Sum of final customer payouts for completed settlements.",
            "platform_revenue": "Sum of platform fees recorded on completed settlements (default zero for customers).",
            "payouts_recorded": "Sum of payments confirmed by customers or verified by an admin.",
            "cancellation_rate": "Cancelled bookings / closed bookings (completed, cancelled, failed) created in the last 90 days.",
            "dispute_rate": "Distinct bookings with a dispute / closed bookings created in the last 90 days.",
            "bookings_in_progress": "Bookings from offer-selected through settlement-pending.",
            "completed_collections": "All bookings with status completed.",
        },
    }


def dealer_rows(db: Session, *, status: str | None, search: str | None, page: int, page_size: int):
    stmt = select(DealerProfile).options(
        selectinload(DealerProfile.user),
        selectinload(DealerProfile.city),
        selectinload(DealerProfile.documents),
    )
    if status:
        stmt = stmt.where(DealerProfile.status == status)
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(
            func.lower(DealerProfile.business_name).like(like)
            | func.lower(DealerProfile.contact_person).like(like)
        )
    total = _count(db, select(func.count()).select_from(stmt.subquery()))
    rows = (
        db.execute(
            stmt.order_by(DealerProfile.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return total, rows


def approve_dealer(
    db: Session, dealer: DealerProfile, admin: User, *, reason: str | None, http_request: Request | None
) -> DealerProfile:
    if dealer.status == "approved":
        raise ConflictError("Dealer is already approved.")
    if dealer.status == "suspended":
        raise ConflictError("Reactivate the suspended dealer instead.")
    if not dealer.documents:
        raise ValidationError("At least one verification document must be uploaded.")
    if not dealer.categories:
        raise ValidationError("The dealer must select at least one material category.")
    if not dealer.service_areas:
        raise ValidationError("The dealer must configure at least one service area.")
    before = dealer.status
    dealer.status = "approved"
    dealer.verified_at = utcnow()
    dealer.verified_by = admin.id
    dealer.verification_notes = reason
    dealer.rejection_reason = None
    dealer.suspended_at = None
    dealer.suspension_reason = None
    notifications.notify(
        db,
        user_id=dealer.user_id,
        type="dealer_approved",
        title="Dealer account verified",
        body=(
            "Your ScrapSetu dealer account is verified. New matching requests in your "
            "service areas will appear on your dashboard."
        ),
        data={"dealer_id": dealer.id},
        dedupe_key=f"dealer-approved:{dealer.id}:{utcnow().timestamp()}",
    )
    audit.record(
        db, actor=admin, action="dealer.approved", entity_type="dealer_profile",
        entity_id=dealer.id, before={"status": before}, after={"status": "approved"},
        reason=reason, request=http_request,
    )
    db.commit()
    return dealer


def reject_dealer(
    db: Session, dealer: DealerProfile, admin: User, *, reason: str, http_request: Request | None
) -> DealerProfile:
    if dealer.status == "approved":
        raise ConflictError("Suspend an approved dealer instead of rejecting.")
    before = dealer.status
    dealer.status = "rejected"
    dealer.rejection_reason = reason
    dealer.accepts_new_requests = False
    notifications.notify(
        db,
        user_id=dealer.user_id,
        type="dealer_rejected",
        title="Dealer application needs attention",
        body=f"Your dealer application was not approved. Reason: {reason}",
        data={"dealer_id": dealer.id},
        dedupe_key=f"dealer-rejected:{dealer.id}:{utcnow().timestamp()}",
    )
    audit.record(
        db, actor=admin, action="dealer.rejected", entity_type="dealer_profile",
        entity_id=dealer.id, before={"status": before}, after={"status": "rejected"},
        reason=reason, request=http_request,
    )
    db.commit()
    return dealer


def suspend_dealer(
    db: Session, dealer: DealerProfile, admin: User, *, reason: str, http_request: Request | None
) -> DealerProfile:
    if dealer.status == "suspended":
        raise ConflictError("Dealer is already suspended.")
    before = dealer.status
    dealer.status = "suspended"
    dealer.suspended_at = utcnow()
    dealer.suspension_reason = reason
    dealer.accepts_new_requests = False
    notifications.notify(
        db,
        user_id=dealer.user_id,
        type="dealer_suspended",
        title="Dealer account suspended",
        body=f"Your dealer account has been suspended. Reason: {reason}",
        data={"dealer_id": dealer.id},
        dedupe_key=f"dealer-suspended:{dealer.id}:{utcnow().timestamp()}",
    )
    audit.record(
        db, actor=admin, action="dealer.suspended", entity_type="dealer_profile",
        entity_id=dealer.id, before={"status": before}, after={"status": "suspended"},
        reason=reason, request=http_request,
    )
    db.commit()
    return dealer


def reactivate_dealer(
    db: Session, dealer: DealerProfile, admin: User, *, reason: str, http_request: Request | None
) -> DealerProfile:
    if dealer.status not in ("suspended", "rejected"):
        raise ConflictError("Only suspended or rejected dealers can be reactivated.")
    if not dealer.documents:
        raise ValidationError("Verification documents are required before reactivation.")
    before = dealer.status
    dealer.status = "approved"
    dealer.suspended_at = None
    dealer.suspension_reason = None
    dealer.rejection_reason = None
    dealer.verified_at = utcnow()
    dealer.verified_by = admin.id
    dealer.accepts_new_requests = True
    notifications.notify(
        db,
        user_id=dealer.user_id,
        type="dealer_reactivated",
        title="Dealer account reactivated",
        body="Your dealer account is active again. You can receive new requests.",
        data={"dealer_id": dealer.id},
        dedupe_key=f"dealer-reactivated:{dealer.id}:{utcnow().timestamp()}",
    )
    audit.record(
        db, actor=admin, action="dealer.reactivated", entity_type="dealer_profile",
        entity_id=dealer.id, before={"status": before}, after={"status": "approved"},
        reason=reason, request=http_request,
    )
    db.commit()
    return dealer


def set_user_status(
    db: Session, user: User, admin: User, *, action: str, reason: str, http_request: Request | None
) -> User:
    if user.role == Role.ADMIN:
        raise ValidationError("Administrator accounts cannot be suspended from this screen.")
    if action == "suspend":
        if user.status == UserStatus.SUSPENDED:
            raise ConflictError("User is already suspended.")
        before = user.status
        user.status = UserStatus.SUSPENDED
        user.suspension_reason = reason
        audit_action = "user.suspended"
    elif action == "reinstate":
        if user.status != UserStatus.SUSPENDED:
            raise ConflictError("Only suspended users can be reinstated.")
        before = user.status
        user.status = UserStatus.ACTIVE
        user.suspension_reason = None
        audit_action = "user.reinstated"
    else:
        raise ValidationError("Unsupported user action.")
    audit.record(
        db, actor=admin, action=audit_action, entity_type="user", entity_id=user.id,
        before={"status": before}, after={"status": user.status}, reason=reason,
        request=http_request,
    )
    db.commit()
    return user


def resolve_dispute(
    db: Session,
    dispute: Dispute,
    admin: User,
    payload: ResolveDisputeBody,
    *,
    http_request: Request | None,
) -> Dispute:
    if dispute.status in (DisputeStatus.RESOLVED, DisputeStatus.WITHDRAWN):
        raise ConflictError("This dispute is already closed.")
    booking = dispute.booking
    if not booking:
        raise NotFoundError("Booking not found for this dispute.")

    if payload.outcome == "adjust_settlement":
        if payload.adjusted_final_payout is None:
            raise ValidationError("Provide the adjusted final payout.")
        base = booking.settlements[-1] if booking.settlements else None
        if not base:
            raise ConflictError("There is no settlement to adjust.")
        new_final = q2(payload.adjusted_final_payout)
        gross = base.gross_amount
        fee = base.platform_fee
        deductions = (
            q2(payload.adjusted_deductions)
            if payload.adjusted_deductions is not None
            else base.deductions
        )
        deduction_reason = payload.deduction_reason or base.deduction_reason
        if deductions > base.deductions and not payload.deduction_reason:
            raise ValidationError(
                "Increasing deductions requires a deduction reason."
            )
        if deductions < base.deductions:
            raise ValidationError(
                "Administrators cannot reduce recorded deductions; lower the payout instead."
            )
        adjustments = q2(new_final - (gross - deductions - fee))
        if adjustments < 0:
            raise ValidationError(
                "The adjusted payout cannot be lower than gross minus deductions and fees; "
                "record a deduction with a reason instead."
            )
        settlement = Settlement(
            booking_id=booking.id,
            version=base.version + 1,
            snapshot_id=base.snapshot_id,
            status=SettlementStatus.SUBMITTED,
            gross_amount=gross,
            deductions=deductions,
            adjustments=adjustments,
            platform_fee=fee,
            final_payout=new_final,
            deduction_reason=deduction_reason,
            notes=f"Admin adjustment: {payload.resolution}",
            submitted_by=admin.id,
            submitted_at=utcnow(),
            admin_adjusted_by=admin.id,
            admin_adjustment_reason=payload.resolution,
            calculation={
                **(base.calculation or {}),
                "admin_adjusted": True,
                "previous_final_payout": str(base.final_payout),
                "adjusted_final_payout": str(new_final),
                "deductions": str(deductions),
                "adjustments": str(adjustments),
                "final_payout": str(new_final),
                "reason": payload.resolution,
                "adjusted_at": utcnow().isoformat(),
            },
        )
        db.add(settlement)
        db.flush()
        for item in base.items:
            db.add(
                SettlementItem(
                    settlement_id=settlement.id,
                    category_id=item.category_id,
                    actual_weight_kg=item.actual_weight_kg,
                    accepted_rate_per_kg=item.accepted_rate_per_kg,
                    final_rate_per_kg=item.final_rate_per_kg,
                    line_total=item.line_total,
                    rate_changed=item.rate_changed,
                    change_reason=item.change_reason,
                    customer_consent_required=True,
                    customer_consent=None,
                )
            )
        dispute.status = DisputeStatus.RESOLVED
        dispute.resolution = payload.resolution
        dispute.resolved_by = admin.id
        dispute.resolved_at = utcnow()
        target = BookingStatus.SETTLEMENT_PENDING
        if booking.status == BookingStatus.DISPUTED:
            transition(
                db,
                booking,
                target,
                actor_id=admin.id,
                actor_role="admin",
                reason=f"Dispute resolved with an adjusted settlement: {payload.resolution}",
                metadata={"dispute_id": dispute.id, "settlement_id": settlement.id},
            )
        notifications.notify(
            db,
            user_id=booking.customer_id,
            type="dispute_updated",
            title="Your dispute was resolved",
            body=(
                f"{booking.reference}: a revised payout of ₹{new_final} is ready for your "
                "confirmation. Please review the updated breakdown."
            ),
            data={"booking_id": booking.id, "dispute_id": dispute.id},
            dedupe_key=f"dispute-adjust:{dispute.id}",
        )
        audit.record(
            db, actor=admin, action="dispute.adjusted", entity_type="dispute",
            entity_id=dispute.id,
            after={
                "booking_id": booking.id,
                "previous_payout": str(base.final_payout),
                "new_payout": str(new_final),
                "settlement_version": settlement.version,
            },
            reason=payload.resolution, request=http_request,
        )
        db.commit()
        return dispute

    if not payload.booking_status_after:
        raise ValidationError("Choose what should happen to the booking after resolution.")

    dispute.status = DisputeStatus.RESOLVED
    dispute.resolution = payload.resolution
    dispute.resolved_by = admin.id
    dispute.resolved_at = utcnow()

    target_status = payload.booking_status_after
    if booking.status == BookingStatus.DISPUTED:
        if target_status == "completed":
            latest = booking.settlements[-1] if booking.settlements else None
            if latest and latest.status == SettlementStatus.DISPUTED:
                latest.status = SettlementStatus.CUSTOMER_CONFIRMED
                latest.customer_confirmed_at = utcnow()
            transition(
                db,
                booking,
                BookingStatus.COMPLETED,
                actor_id=admin.id,
                actor_role="admin",
                reason=f"Dispute resolved by admin: {payload.resolution}",
                metadata={"dispute_id": dispute.id, "admin_override": True},
            )
            latest = booking.settlements[-1] if booking.settlements else None
            if latest:
                latest.status = SettlementStatus.COMPLETED
                latest.completed_at = utcnow()
                latest.paid_at = latest.paid_at or utcnow()
            booking.request.status = RequestStatus.COMPLETED
            booking.dealer.completed_jobs += 1
        elif target_status == "cancelled":
            transition(
                db, booking, BookingStatus.CANCELLED, actor_id=admin.id,
                actor_role="admin", reason=payload.resolution,
                metadata={"dispute_id": dispute.id},
            )
            booking.cancelled_by = admin.id
            booking.cancellation_reason = payload.resolution
        else:
            latest = booking.settlements[-1] if booking.settlements else None
            if latest and latest.status == SettlementStatus.DISPUTED:
                latest.status = SettlementStatus.SUBMITTED
            transition(
                db, booking, BookingStatus.SETTLEMENT_PENDING, actor_id=admin.id,
                actor_role="admin", reason=f"Dispute resolved: {payload.resolution}",
                metadata={"dispute_id": dispute.id},
            )
    for party in (booking.customer_id, booking.dealer.user_id):
        notifications.notify(
            db,
            user_id=party,
            type="dispute_updated",
            title="Dispute resolved",
            body=f"{booking.reference}: {payload.resolution}",
            data={"booking_id": booking.id, "dispute_id": dispute.id},
            dedupe_key=f"dispute-resolved:{dispute.id}:{party}",
        )
    audit.record(
        db, actor=admin, action="dispute.resolved", entity_type="dispute",
        entity_id=dispute.id,
        after={"outcome": payload.outcome, "booking_status": booking.status},
        reason=payload.resolution, request=http_request,
    )
    db.commit()
    return dispute


def verify_payment(
    db: Session, payment: PaymentRecord, admin: User, *, note: str, http_request: Request | None
) -> PaymentRecord:
    if payment.status == PaymentStatus.CONFIRMED:
        raise ConflictError("Payment is already confirmed.")
    if payment.status not in (PaymentStatus.RECORDED, PaymentStatus.PENDING):
        raise ConflictError("Only a recorded payment can be reconciled.")
    payment.status = PaymentStatus.CONFIRMED
    payment.verified_at = utcnow()
    db.add(
        PaymentEvent(
            payment_id=payment.id,
            event_type="admin_reconciled",
            payload={"note": note, "verified_by": admin.id, "gateway_verified": False},
            created_by=admin.id,
        )
    )
    from app.services.bookings import load_booking, maybe_complete

    booking = load_booking(db, payment.booking_id)
    audit.record(
        db, actor=admin, action="payment.reconciled", entity_type="payment",
        entity_id=payment.id, before={"status": "recorded"},
        after={"status": "confirmed", "note": note}, reason=note,
        request=http_request,
    )
    db.flush()
    maybe_complete(db, booking, actor_id=admin.id, actor_role="admin")
    db.commit()
    return payment


def moderate_review(
    db: Session, review: Review, admin: User, *, action: str, note: str | None,
    http_request: Request | None,
) -> Review:
    mapping = {"hide": ReviewStatus.HIDDEN, "publish": ReviewStatus.PUBLISHED, "flag": ReviewStatus.FLAGGED}
    if action not in mapping:
        raise ValidationError("Unsupported moderation action.")
    before = review.status
    review.status = mapping[action]
    review.admin_note = note
    review.moderated_by = admin.id
    review.moderated_at = utcnow()
    recalc_dealer_rating(db, review.dealer_id)
    audit.record(
        db, actor=admin, action=f"review.{action}", entity_type="review",
        entity_id=review.id, before={"status": before}, after={"status": review.status},
        reason=note, request=http_request,
    )
    db.commit()
    return review


def recalc_dealer_rating(db: Session, dealer_id: str) -> None:
    dealer = db.get(DealerProfile, dealer_id)
    if not dealer:
        return
    row = db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(
            Review.dealer_id == dealer_id,
            Review.status == ReviewStatus.PUBLISHED.value,
        )
    ).one()
    dealer.rating_avg = q2(money(row[0] or 0))
    dealer.rating_count = int(row[1] or 0)


def list_audit_logs(
    db: Session,
    *,
    action: str | None,
    entity_type: str | None,
    actor_id: str | None,
    since: datetime | None,
    until: datetime | None,
    page: int,
    page_size: int,
):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"%{action}%"))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if since:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until:
        stmt = stmt.where(AuditLog.created_at <= until)
    total = _count(db, select(func.count()).select_from(stmt.subquery()))
    rows = (
        db.execute(
            stmt.order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return total, rows


# --- CSV exports ------------------------------------------------------------


def _csv_safe(value: object) -> object:
    """Neutralise spreadsheet formula injection without changing numeric cells."""
    if not isinstance(value, str):
        return value
    if value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def _csv_response(rows: list[list], headers: list[str], *, kind: str = "export") -> tuple[bytes, str]:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    writer.writerows([[_csv_safe(cell) for cell in row] for row in rows])
    content = buffer.getvalue().encode("utf-8-sig")
    filename = f"scrapsetu-{kind}-{datetime.utcnow():%Y%m%d-%H%M%S}.csv"
    return content, filename


def export_rows(db: Session, kind: str, *, limit: int = 5000) -> tuple[bytes, str]:
    if kind == "bookings":
        headers = [
            "booking_reference", "status", "created_at", "scheduled_date", "time_window",
            "locality", "city", "customer", "dealer", "quoted_payout", "final_payout",
            "payment_method", "payment_status",
        ]
        rows = []
        for booking in db.execute(
            select(Booking).order_by(Booking.created_at.desc()).limit(limit)
        ).scalars():
            settlement = booking.settlements[-1] if booking.settlements else None
            payment = booking.payments[-1] if booking.payments else None
            rows.append(
                [
                    booking.reference,
                    booking.status,
                    booking.created_at.isoformat(),
                    booking.scheduled_date.isoformat(),
                    booking.time_window,
                    booking.request.locality if booking.request else "",
                    booking.request.city.name if booking.request and booking.request.city else "",
                    booking.customer.profile.full_name if booking.customer and booking.customer.profile else "",
                    booking.dealer.business_name if booking.dealer else "",
                    str(booking.accepted_payout),
                    str(settlement.final_payout) if settlement else "",
                    payment.method if payment else "",
                    payment.status if payment else "",
                ]
            )
        return _csv_response(rows, headers, kind=kind)
    if kind == "dealers":
        headers = [
            "dealer_id", "business_name", "status", "city", "locality", "min_collection_kg",
            "completed_jobs", "cancelled_jobs", "rating_avg", "rating_count", "verified_at",
        ]
        rows = [
            [
                d.id, d.business_name, d.status,
                d.city.name if d.city else "", d.locality or "",
                str(d.min_collection_kg), d.completed_jobs, d.cancelled_jobs,
                str(d.rating_avg), d.rating_count,
                d.verified_at.isoformat() if d.verified_at else "",
            ]
            for d in db.execute(
                select(DealerProfile).order_by(DealerProfile.created_at.desc()).limit(limit)
            ).scalars()
        ]
        return _csv_response(rows, headers, kind=kind)
    if kind == "disputes":
        headers = [
            "dispute_id", "booking_reference", "category", "status", "raised_by_role",
            "created_at", "resolved_at", "resolution",
        ]
        rows = [
            [
                d.id,
                d.booking.reference if d.booking else "",
                d.category, d.status, d.raised_by_role,
                d.created_at.isoformat(),
                d.resolved_at.isoformat() if d.resolved_at else "",
                (d.resolution or "").replace("\n", " "),
            ]
            for d in db.execute(
                select(Dispute).order_by(Dispute.created_at.desc()).limit(limit)
            ).scalars()
        ]
        return _csv_response(rows, headers, kind=kind)
    if kind == "audit-logs":
        headers = ["created_at", "actor_id", "actor_role", "action", "entity_type", "entity_id", "reason"]
        rows = [
            [
                log.created_at.isoformat(), log.actor_id or "", log.actor_role or "",
                log.action, log.entity_type, log.entity_id or "",
                (log.reason or "").replace("\n", " "),
            ]
            for log in db.execute(
                select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
            ).scalars()
        ]
        return _csv_response(rows, headers, kind=kind)
    raise ValidationError("Unknown export type.")


def open_support_rows(db: Session, *, status: str | None, page: int, page_size: int):
    stmt = select(SupportTicket)
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    total = _count(db, select(func.count()).select_from(stmt.subquery()))
    rows = (
        db.execute(
            stmt.order_by(SupportTicket.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return total, rows

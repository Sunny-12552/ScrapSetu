"""Dealer offers: versioning, expiry, and exclusive acceptance."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.constants import local_today
from app.core.errors import ConflictError, ForbiddenError, ValidationError
from app.core.security import generate_reference
from app.core.time import utcnow
from app.models import (
    Booking,
    BookingStatus,
    DealerOffer,
    DealerOfferItem,
    DealerProfile,
    OfferAcceptanceSnapshot,
    OfferStatus,
    RequestStatus,
    ScrapRequest,
)
from app.schemas import OfferCreate, OfferUpdate
from app.services import audit, notifications
from app.services.settlement import line_total, q2


def offer_query():
    return select(DealerOffer).options(
        selectinload(DealerOffer.items).selectinload(DealerOfferItem.category),
        selectinload(DealerOffer.dealer).selectinload(DealerProfile.city),
        selectinload(DealerOffer.dealer).selectinload(DealerProfile.service_areas),
        selectinload(DealerOffer.request),
    )


def load_offer(db: Session, offer_id: str) -> DealerOffer:
    offer = db.execute(
        offer_query()
        .where(DealerOffer.id == offer_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if not offer:
        from app.core.errors import NotFoundError

        raise NotFoundError("Offer not found.")
    return offer


def load_request_locked(db: Session, request_id: str) -> ScrapRequest:
    request = db.execute(
        select(ScrapRequest)
        .where(ScrapRequest.id == request_id)
        .with_for_update()
    ).scalar_one_or_none()
    if not request:
        from app.core.errors import NotFoundError

        raise NotFoundError("Scrap request not found.")
    return request


def recount_offers(db: Session, request_id: str) -> None:
    from app.models import ScrapRequest as SR

    count = int(
        db.execute(
            select(func.count(DealerOffer.id)).where(
                DealerOffer.request_id == request_id,
                DealerOffer.status == OfferStatus.SUBMITTED.value,
            )
        ).scalar_one()
    )
    request = db.get(SR, request_id)
    if request:
        request.offer_count = count


def _validate_offer_window(payload: OfferCreate | OfferUpdate, request: ScrapRequest) -> None:
    now = utcnow()
    if payload.pickup_date is not None:
        if payload.pickup_date < local_today():
            raise ValidationError("Pickup date cannot be in the past.")
        if (payload.pickup_date - local_today()).days > 45:
            raise ValidationError("Pickup date is too far in the future.")
    if payload.valid_until is not None:
        if payload.valid_until <= now + timedelta(minutes=30):
            raise ValidationError("Offer validity must be at least 30 minutes from now.")
        if payload.valid_until > now + timedelta(hours=72):
            raise ValidationError("Offers can stay valid for at most 72 hours.")
        if request.expires_at and payload.valid_until > request.expires_at:
            raise ValidationError(
                "Offer validity cannot extend beyond the listing's offer deadline."
            )


def _build_items(
    offer: DealerOffer, items, request: ScrapRequest
) -> Decimal:
    """Validate categories and build line items. Returns the estimated payout."""
    request_categories = {item.category_id for item in request.items}
    offered_categories = {item.category_id for item in items}
    if offered_categories != request_categories:
        missing = request_categories - offered_categories
        extra = offered_categories - request_categories
        problems = []
        if missing:
            problems.append(f"{len(missing)} requested material(s) are missing a rate")
        if extra:
            problems.append(f"{len(extra)} material(s) are not part of the request")
        raise ValidationError(
            "; ".join(problems) + ". Quote every requested material exactly once."
        )

    for existing in list(offer.items):
        offer.items.remove(existing)

    total = Decimal("0")
    for payload in items:
        line = line_total(payload.estimated_weight_kg, payload.rate_per_kg)
        total += line
        offer.items.append(
            DealerOfferItem(
                category_id=payload.category_id,
                rate_per_kg=payload.rate_per_kg,
                estimated_weight_kg=payload.estimated_weight_kg,
                line_total=line,
                notes=payload.notes,
            )
        )
    return q2(total)


def create_offer(
    db: Session,
    dealer: DealerProfile,
    payload: OfferCreate,
    *,
    actor_id: str,
    http_request: Request | None = None,
) -> DealerOffer:
    from app.services.matching import dealer_eligible_for_request
    from app.services.requests import load_request

    request = load_request(db, payload.request_id)
    if request.status != RequestStatus.OPEN:
        raise ConflictError("This listing is no longer accepting offers.")
    if request.expires_at and request.expires_at <= utcnow():
        raise ConflictError("This listing's offer window has closed.")
    eligible, reasons = dealer_eligible_for_request(db, dealer, request)
    if not eligible:
        raise ForbiddenError(
            "You are not eligible to offer on this request.", details=reasons
        )
    _validate_offer_window(payload, request)

    existing = db.execute(
        select(DealerOffer).where(
            DealerOffer.request_id == request.id,
            DealerOffer.dealer_id == dealer.id,
            DealerOffer.status == OfferStatus.SUBMITTED.value,
        )
    ).scalar_one_or_none()
    if existing:
        raise ConflictError(
            "You already have a live offer on this request. Revise it instead.",
            details={"offer_id": existing.id},
        )

    existing_versions = db.execute(
        select(func.max(DealerOffer.version)).where(
            DealerOffer.request_id == request.id,
            DealerOffer.dealer_id == dealer.id,
        )
    ).scalar_one()
    offer = DealerOffer(
        request_id=request.id,
        dealer_id=dealer.id,
        version=int(existing_versions or 0) + 1,
        status=OfferStatus.SUBMITTED,
        estimated_payout=Decimal("0"),
        min_total_weight_kg=payload.min_total_weight_kg,
        pickup_date=payload.pickup_date,
        pickup_window=payload.pickup_window,
        valid_until=payload.valid_until,
        conditions=payload.conditions,
        disclosure=payload.disclosure,
        submitted_at=utcnow(),
    )
    db.add(offer)
    db.flush()
    offer.estimated_payout = _build_items(offer, payload.items, request)
    recount_offers(db, request.id)

    notifications.notify(
        db,
        user_id=request.customer_id,
        type="offer_received",
        title="New dealer offer received",
        body=(
            f"{dealer.business_name} offered about ₹{offer.estimated_payout} "
            f"for {request.reference}. Compare offers before the quote expires."
        ),
        data={"request_id": request.id, "offer_id": offer.id},
        dedupe_key=f"offer-received:{offer.id}",
    )
    audit.record(
        db,
        actor=None,
        action="offer.created",
        entity_type="dealer_offer",
        entity_id=offer.id,
        after={
            "request_id": request.id,
            "dealer_id": dealer.id,
            "estimated_payout": str(offer.estimated_payout),
        },
        request=http_request,
    )
    db.commit()
    return load_offer(db, offer.id)


def revise_offer(
    db: Session,
    offer: DealerOffer,
    payload: OfferUpdate,
    *,
    dealer: DealerProfile,
) -> DealerOffer:
    if offer.dealer_id != dealer.id:
        raise ForbiddenError("This offer belongs to another dealer.")
    if offer.status != OfferStatus.SUBMITTED:
        raise ConflictError("Only a live submitted offer can be revised.")
    if offer.valid_until <= utcnow():
        raise ConflictError("This offer has expired. Submit a new offer instead.")
    request = offer.request
    if request.status != RequestStatus.OPEN:
        raise ConflictError("The listing is no longer accepting offers.")

    merged = OfferCreate(
        request_id=offer.request_id,
        items=payload.items or [
            {
                "category_id": item.category_id,
                "rate_per_kg": item.rate_per_kg,
                "estimated_weight_kg": item.estimated_weight_kg,
                "notes": item.notes,
            }
            for item in offer.items
        ],
        min_total_weight_kg=(
            payload.min_total_weight_kg
            if payload.min_total_weight_kg is not None
            else offer.min_total_weight_kg
        ),
        pickup_date=payload.pickup_date or offer.pickup_date,
        pickup_window=payload.pickup_window or offer.pickup_window,
        valid_until=payload.valid_until or offer.valid_until,
        conditions=payload.conditions if payload.conditions is not None else offer.conditions,
        disclosure=payload.disclosure if payload.disclosure is not None else offer.disclosure,
    )
    _validate_offer_window(merged, request)

    new_offer = DealerOffer(
        request_id=offer.request_id,
        dealer_id=offer.dealer_id,
        version=offer.version + 1,
        status=OfferStatus.SUBMITTED,
        estimated_payout=Decimal("0"),
        min_total_weight_kg=merged.min_total_weight_kg,
        pickup_date=merged.pickup_date,
        pickup_window=merged.pickup_window,
        valid_until=merged.valid_until,
        conditions=merged.conditions,
        disclosure=merged.disclosure,
        submitted_at=utcnow(),
    )
    db.add(new_offer)
    db.flush()
    new_offer.estimated_payout = _build_items(new_offer, merged.items, request)
    offer.status = OfferStatus.SUPERSEDED
    offer.superseded_by_id = new_offer.id
    recount_offers(db, request.id)

    notifications.notify(
        db,
        user_id=request.customer_id,
        type="offer_revised",
        title="A dealer updated their offer",
        body=(
            f"{dealer.business_name} revised the offer for {request.reference} "
            f"to about ₹{new_offer.estimated_payout}. Version {new_offer.version}."
        ),
        data={"request_id": request.id, "offer_id": new_offer.id},
        dedupe_key=f"offer-revised:{new_offer.id}",
        send_sms=False,
    )
    db.commit()
    return load_offer(db, new_offer.id)


def withdraw_offer(db: Session, offer: DealerOffer, *, dealer: DealerProfile) -> DealerOffer:
    if offer.dealer_id != dealer.id:
        raise ForbiddenError("This offer belongs to another dealer.")
    if offer.status != OfferStatus.SUBMITTED:
        raise ConflictError("Only a live submitted offer can be withdrawn.")
    offer.status = OfferStatus.WITHDRAWN
    offer.withdrawn_at = utcnow()
    recount_offers(db, offer.request_id)
    db.commit()
    return load_offer(db, offer.id)


def offers_for_request(db: Session, request_id: str) -> list[DealerOffer]:
    expire_stale_offers(db)
    rows = (
        db.execute(
            offer_query()
            .where(
                DealerOffer.request_id == request_id,
                DealerOffer.status.in_(
                    [
                        OfferStatus.SUBMITTED.value,
                        OfferStatus.ACCEPTED.value,
                        OfferStatus.EXPIRED.value,
                        OfferStatus.NOT_SELECTED.value,
                        OfferStatus.WITHDRAWN.value,
                    ]
                ),
            )
            .order_by(DealerOffer.estimated_payout.desc())
        )
        .scalars()
        .all()
    )
    return rows


def expire_stale_offers(db: Session) -> int:
    now = utcnow()
    rows = (
        db.execute(
            select(DealerOffer)
            .where(
                DealerOffer.status == OfferStatus.SUBMITTED,
                DealerOffer.valid_until <= now,
            )
            .limit(200)
        )
        .scalars()
        .all()
    )
    if not rows:
        return 0
    request_ids = set()
    for offer in rows:
        offer.status = OfferStatus.EXPIRED
        request_ids.add(offer.request_id)
        notifications.notify(
            db,
            user_id=offer.dealer.user_id,
            type="offer_expired",
            title="Your offer expired",
            body=(
                f"Your offer for {offer.request.reference} expired without being accepted. "
                "New matching requests are shown on your dashboard."
            ),
            data={"request_id": offer.request_id, "offer_id": offer.id},
            dedupe_key=f"offer-expired:{offer.id}",
            send_sms=False,
        )
    for request_id in request_ids:
        recount_offers(db, request_id)
    db.commit()
    return len(rows)


def _snapshot_payload(offer: DealerOffer) -> dict:
    request = offer.request
    return {
        "terms_version": 1,
        "request": {
            "id": request.id,
            "reference": request.reference,
            "locality": request.locality,
            "postal_code": request.postal_code,
            "preferred_date": request.preferred_date.isoformat(),
            "time_window": request.time_window,
        },
        "dealer": {
            "id": offer.dealer.id,
            "business_name": offer.dealer.business_name,
        },
        "offer": {
            "id": offer.id,
            "version": offer.version,
            "estimated_payout": str(offer.estimated_payout),
            "min_total_weight_kg": str(offer.min_total_weight_kg),
            "pickup_date": offer.pickup_date.isoformat(),
            "pickup_window": offer.pickup_window,
            "valid_until": offer.valid_until.isoformat(),
            "conditions": offer.conditions,
            "disclosure": offer.disclosure,
        },
        "items": [
            {
                "category_id": item.category_id,
                "category_name": item.category.name if item.category else None,
                "rate_per_kg": str(item.rate_per_kg),
                "estimated_weight_kg": str(item.estimated_weight_kg),
                "line_total": str(item.line_total),
            }
            for item in offer.items
        ],
        "accepted_at": utcnow().isoformat(),
    }


def _booking_reference(db: Session) -> str:
    for _ in range(10):
        ref = generate_reference("SSB")
        if not db.execute(select(Booking.id).where(Booking.reference == ref)).first():
            return ref
    raise ConflictError("Could not allocate a booking reference. Please retry.")


def accept_offer(
    db: Session,
    *,
    offer_id: str,
    customer_id: str,
    http_request: Request | None = None,
) -> Booking:
    """Accept an offer exactly once. Returns the created booking."""
    from app.services.bookings import load_booking

    offer = db.execute(
        offer_query()
        .where(DealerOffer.id == offer_id)
        .with_for_update()
    ).scalar_one_or_none()
    if not offer:
        from app.core.errors import NotFoundError

        raise NotFoundError("Offer not found.")

    request = load_request_locked(db, offer.request_id)
    if request.customer_id != customer_id:
        raise ForbiddenError("This offer belongs to another customer's request.")

    if offer.status == OfferStatus.ACCEPTED:
        raise ConflictError(
            "This offer has already been accepted. Refresh to see the booking.",
            code="already_booked",
        )
    if request.status != RequestStatus.OPEN:
        raise ConflictError(
            "This listing is no longer open. Refresh to see the current booking.",
            code="already_booked",
        )
    if offer.status != OfferStatus.SUBMITTED:
        raise ConflictError("Only a live offer can be accepted.")
    if offer.valid_until <= utcnow():
        offer.status = OfferStatus.EXPIRED
        recount_offers(db, request.id)
        db.commit()
        raise ConflictError("This offer has expired. Ask the dealer for a fresh quote.")
    if request.expires_at and request.expires_at <= utcnow():
        request.status = RequestStatus.EXPIRED
        db.commit()
        raise ConflictError("The offer window for this listing has closed.")
    if offer.dealer.status != "approved" or offer.dealer.user.status != "active":
        raise ConflictError(
            "This dealer is not currently eligible to accept jobs. Please choose another offer."
        )

    snapshot_payload = _snapshot_payload(offer)
    snapshot = OfferAcceptanceSnapshot(
        request_id=request.id,
        dealer_id=offer.dealer_id,
        offer_id=offer.id,
        offer_version=offer.version,
        payload=snapshot_payload,
        accepted_by=customer_id,
    )
    db.add(snapshot)
    db.flush()

    # Recompute server-side from the offer items; never trust a client total.
    server_total = q2(
        sum(
            (line_total(item.estimated_weight_kg, item.rate_per_kg) for item in offer.items),
            Decimal("0"),
        )
    )
    if server_total != offer.estimated_payout:
        raise ConflictError(
            "The offer total could not be verified. Please ask the dealer to resubmit."
        )

    booking = Booking(
        reference=_booking_reference(db),
        request_id=request.id,
        customer_id=customer_id,
        dealer_id=offer.dealer_id,
        offer_id=offer.id,
        snapshot_id=snapshot.id,
        status=BookingStatus.OFFER_SELECTED,
        scheduled_date=offer.pickup_date,
        time_window=offer.pickup_window,
        accepted_payout=server_total,
    )
    db.add(booking)
    db.flush()

    offer.status = OfferStatus.ACCEPTED
    offer.accepted_at = utcnow()
    for other in request.offers:
        if other.id != offer.id and other.status == OfferStatus.SUBMITTED:
            other.status = OfferStatus.NOT_SELECTED
    request.status = RequestStatus.OFFER_SELECTED
    request.offer_count = 0

    from app.models import BookingStatusHistory

    db.add(
        BookingStatusHistory(
            booking_id=booking.id,
            from_status=None,
            to_status=BookingStatus.OFFER_SELECTED,
            actor_id=customer_id,
            actor_role="customer",
            reason="Customer accepted a dealer offer.",
            event_metadata={"offer_id": offer.id, "offer_version": offer.version},
        )
    )

    notifications.notify(
        db,
        user_id=request.customer_id,
        type="offer_accepted",
        title="Offer accepted",
        body=(
            f"You accepted {offer.dealer.business_name}'s offer for {request.reference}. "
            "The dealer will confirm the pickup shortly."
        ),
        data={"booking_id": booking.id},
        dedupe_key=f"offer-accepted-customer:{booking.id}",
    )
    notifications.notify(
        db,
        user_id=offer.dealer.user_id,
        type="offer_accepted",
        title="Your offer was accepted",
        body=(
            f"Job {booking.reference}: {request.locality} on {booking.scheduled_date}. "
            "Confirm the job to view the full pickup address."
        ),
        data={"booking_id": booking.id},
        dedupe_key=f"offer-accepted-dealer:{booking.id}",
    )
    for other in request.offers:
        if other.status == OfferStatus.NOT_SELECTED:
            notifications.notify(
                db,
                user_id=other.dealer.user_id,
                type="offer_not_selected",
                title="Offer not selected",
                body=(
                    f"Your offer for {request.reference} was not selected. "
                    "The listing is now assigned to another dealer."
                ),
                data={"request_id": request.id},
                dedupe_key=f"offer-not-selected:{other.id}",
                send_sms=False,
            )

    audit.record(
        db,
        actor=None,
        action="offer.accepted",
        entity_type="booking",
        entity_id=booking.id,
        after={
            "offer_id": offer.id,
            "request_id": request.id,
            "dealer_id": offer.dealer_id,
            "accepted_payout": str(server_total),
        },
        request=http_request,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "Another offer was accepted for this listing at the same time. Please refresh.",
            code="already_booked",
        ) from exc

    return load_booking(db, booking.id)

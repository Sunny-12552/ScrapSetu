"""Customer scrap request lifecycle, dashboards, and address management."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.constants import MAX_LISTING_DAYS_AHEAD, local_today
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.security import generate_reference
from app.core.time import utcnow
from app.models import (
    Booking,
    BookingStatus,
    City,
    CustomerAddress,
    DealerOffer,
    MaterialCategory,
    OfferStatus,
    PaymentStatus,
    RequestStatus,
    Review,
    ScrapImage,
    ScrapRequest,
    ScrapRequestItem,
    SettlementStatus,
    User,
)
from app.schemas import RequestCreate, RequestItemIn, RequestUpdate
from app.services import notifications
from app.services.serializers import decimal_str
from app.services.settlement import q2

REQUEST_EXPIRY_DAYS = 7


def _unique_reference(db: Session) -> str:
    for _ in range(10):
        ref = generate_reference("SSR")
        exists = db.execute(
            select(ScrapRequest.id).where(ScrapRequest.reference == ref)
        ).first()
        if not exists:
            return ref
    raise ConflictError("Could not allocate a request reference. Please retry.")


def request_query():
    return select(ScrapRequest).options(
        selectinload(ScrapRequest.items).selectinload(ScrapRequestItem.category),
        selectinload(ScrapRequest.images),
        selectinload(ScrapRequest.city),
        selectinload(ScrapRequest.booking),
        selectinload(ScrapRequest.customer).selectinload(User.profile),
    )


def load_request(db: Session, request_id: str) -> ScrapRequest:
    request = db.execute(
        request_query()
        .where(ScrapRequest.id == request_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if not request or request.deleted_at is not None:
        raise NotFoundError("Scrap request not found.")
    return request


def assert_customer_owns(request: ScrapRequest, user: User) -> None:
    if request.customer_id != user.id:
        raise ForbiddenError("This scrap request belongs to another customer.")


def validate_categories(db: Session, items: list[RequestItemIn]) -> dict[str, MaterialCategory]:
    ids = [item.category_id for item in items]
    rows = db.execute(
        select(MaterialCategory).where(MaterialCategory.id.in_(ids))
    ).scalars().all()
    found = {row.id: row for row in rows}
    missing = [i for i in ids if i not in found]
    if missing:
        raise ValidationError("One or more selected materials are unavailable.")
    inactive = [row.name for row in rows if not row.is_active]
    if inactive:
        raise ValidationError(
            "These materials are not currently accepted: " + ", ".join(inactive)
        )
    return found


def validate_schedule(preferred_date: date, time_window: str) -> None:
    today = local_today()
    if preferred_date <= today:
        raise ValidationError("Choose a pickup date from tomorrow onwards.")
    if preferred_date > today + timedelta(days=MAX_LISTING_DAYS_AHEAD):
        raise ValidationError(
            f"Pickup dates can be at most {MAX_LISTING_DAYS_AHEAD} days ahead."
        )
    from app.core.constants import TIME_WINDOWS

    if time_window not in TIME_WINDOWS:
        raise ValidationError("Choose a valid pickup time window.")


def _address_snapshot(address: CustomerAddress, city: City | None) -> dict:
    return {
        "line1": address.line1,
        "line2": address.line2,
        "locality": address.locality,
        "city": city.name if city else None,
        "postal_code": address.postal_code,
        "contact_name": address.contact_name,
        "contact_phone": address.contact_phone,
    }


def _apply_items(db: Session, request: ScrapRequest, items: list[RequestItemIn]) -> None:
    validate_categories(db, items)
    existing = {item.category_id: item for item in request.items}
    incoming = {item.category_id: item for item in items}
    for category_id, item in existing.items():
        if category_id not in incoming:
            db.delete(item)
    for category_id, payload in incoming.items():
        item = existing.get(category_id)
        if item is None:
            item = ScrapRequestItem(request_id=request.id, category_id=category_id)
            request.items.append(item)
        item.estimated_weight_kg = payload.estimated_weight_kg
        item.estimated_quantity = payload.estimated_quantity
        item.quantity_unit = payload.quantity_unit
        item.condition_notes = payload.condition_notes
    db.flush()
    total = sum(
        (payload.estimated_weight_kg or Decimal("0") for payload in incoming.values()),
        Decimal("0"),
    )
    request.estimated_total_weight_kg = q2(total) if total > 0 else None


def create_request(db: Session, user: User, payload: RequestCreate) -> ScrapRequest:
    address = db.get(CustomerAddress, payload.address_id)
    if not address or address.customer_id != user.id or not address.is_active:
        raise ValidationError("Choose one of your saved pickup addresses.")
    city = db.get(City, address.city_id)
    if not city or not city.is_active:
        raise ValidationError("Pickup city is not currently served.")
    validate_schedule(payload.preferred_date, payload.time_window)
    request = ScrapRequest(
        reference=_unique_reference(db),
        customer_id=user.id,
        address_id=address.id,
        city_id=address.city_id,
        locality=address.locality,
        postal_code=address.postal_code,
        address_snapshot=_address_snapshot(address, city),
        preferred_date=payload.preferred_date,
        time_window=payload.time_window,
        customer_notes=payload.customer_notes,
        status=RequestStatus.DRAFT,
    )
    db.add(request)
    db.flush()
    _apply_items(db, request, payload.items)
    db.commit()
    return load_request(db, request.id)


def update_request(
    db: Session, request: ScrapRequest, user: User, payload: RequestUpdate
) -> ScrapRequest:
    assert_customer_owns(request, user)
    if request.status not in (RequestStatus.DRAFT,):
        raise ConflictError("Only draft listings can be edited. Contact support for changes.")
    if payload.preferred_date or payload.time_window:
        validate_schedule(
            payload.preferred_date or request.preferred_date,
            payload.time_window or request.time_window,
        )
        if payload.preferred_date:
            request.preferred_date = payload.preferred_date
        if payload.time_window:
            request.time_window = payload.time_window
    if payload.customer_notes is not None:
        request.customer_notes = payload.customer_notes
    if payload.items is not None:
        _apply_items(db, request, payload.items)
    request.version += 1
    db.commit()
    return load_request(db, request.id)


def submit_request(db: Session, request: ScrapRequest, user: User) -> ScrapRequest:
    assert_customer_owns(request, user)
    if request.status != RequestStatus.DRAFT:
        raise ConflictError("This listing has already been submitted.")
    if not request.items:
        raise ValidationError("Add at least one material before submitting.")
    if not [img for img in request.images if img.deleted_at is None]:
        raise ValidationError("Add at least one photo of the scrap before submitting.")
    validate_schedule(request.preferred_date, request.time_window)
    address = db.get(CustomerAddress, request.address_id) if request.address_id else None
    if not address:
        raise ValidationError("The pickup address is no longer available.")
    city = db.get(City, request.city_id)
    request.address_snapshot = _address_snapshot(address, city)
    now = utcnow()
    request.status = RequestStatus.OPEN
    request.published_at = now
    request.expires_at = now + timedelta(days=REQUEST_EXPIRY_DAYS)
    request.version += 1
    notifications.notify(
        db,
        user_id=user.id,
        type="listing_submitted",
        title="Your scrap listing is live",
        body=(
            f"{request.reference}: verified dealers in {request.locality} can now send offers. "
            f"Offers close on {request.expires_at:%d %b %Y}."
        ),
        data={"request_id": request.id},
        dedupe_key=f"listing-submitted:{request.id}",
    )
    db.commit()

    # Notify explainably matched dealers (best effort; notification failure cannot
    # break the customer's submission).
    from app.services.matching import eligible_dealers

    try:
        candidates, _ = eligible_dealers(db, request)
        for candidate in candidates[:50]:
            notifications.notify(
                db,
                user_id=candidate.dealer.user_id,
                type="new_request",
                title="New scrap request near you",
                body=(
                    f"{len(request.items)} material(s), about "
                    f"{request.estimated_total_weight_kg or 0} kg in {request.locality}. "
                    "Review it and send an offer."
                ),
                data={"request_id": request.id},
                dedupe_key=f"new-request:{request.id}:{candidate.dealer.id}",
                send_sms=False,
            )
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    return load_request(db, request.id)


def expire_stale_requests(db: Session) -> int:
    now = utcnow()
    expired = 0
    rows = db.execute(
        select(ScrapRequest).where(
            ScrapRequest.status == RequestStatus.OPEN,
            ScrapRequest.expires_at.is_not(None),
            ScrapRequest.expires_at < now,
        )
    ).scalars().all()
    for request in rows:
        request.status = RequestStatus.EXPIRED
        expired += 1
        notifications.notify(
            db,
            user_id=request.customer_id,
            type="listing_expired",
            title="Your scrap listing expired",
            body=(
                f"{request.reference} did not receive an accepted offer in time. "
                "You can create a new listing or widen your preferred time window."
            ),
            data={"request_id": request.id},
            dedupe_key=f"listing-expired:{request.id}",
            send_sms=False,
        )
    if expired:
        db.commit()
    return expired


def customer_dashboard(db: Session, user: User) -> dict:
    from app.services.notifications import unread_count

    request_ids_subq = select(ScrapRequest.id).where(ScrapRequest.customer_id == user.id)

    def count_requests(statuses: tuple[str, ...]) -> int:
        return int(
            db.execute(
                select(func.count(ScrapRequest.id)).where(
                    ScrapRequest.customer_id == user.id,
                    ScrapRequest.status.in_(statuses),
                )
            ).scalar_one()
        )

    bookings = (
        db.execute(
            select(Booking).where(Booking.customer_id == user.id)
        )
        .scalars()
        .all()
    )
    active_statuses = {
        BookingStatus.OFFER_SELECTED.value,
        BookingStatus.BOOKING_CONFIRMED.value,
        BookingStatus.PICKUP_IN_PROGRESS.value,
        BookingStatus.WEIGHING_RECORDED.value,
        BookingStatus.SETTLEMENT_PENDING.value,
    }
    upcoming = sum(
        1
        for b in bookings
        if b.status in (BookingStatus.OFFER_SELECTED.value, BookingStatus.BOOKING_CONFIRMED.value)
        and b.scheduled_date >= local_today()
    )
    ongoing = sum(1 for b in bookings if b.status in active_statuses)
    completed = sum(1 for b in bookings if b.status == BookingStatus.COMPLETED.value)

    earnings = db.execute(
        select(func.coalesce(func.sum(Booking.accepted_payout), 0)).where(
            Booking.customer_id == user.id,
            Booking.status == BookingStatus.COMPLETED.value,
        )
    ).scalar_one()

    incoming_offers = int(
        db.execute(
            select(func.count(DealerOffer.id))
            .join(ScrapRequest, ScrapRequest.id == DealerOffer.request_id)
            .where(
                ScrapRequest.customer_id == user.id,
                DealerOffer.status == OfferStatus.SUBMITTED.value,
            )
        ).scalar_one()
    )
    pending_settlements = int(
        db.execute(
            select(func.count(Booking.id)).where(
                Booking.customer_id == user.id,
                Booking.status.in_(
                    [
                        BookingStatus.WEIGHING_RECORDED.value,
                        BookingStatus.SETTLEMENT_PENDING.value,
                    ]
                ),
            )
        ).scalar_one()
    )
    recent_bookings = (
        db.execute(
            select(Booking)
            .where(Booking.customer_id == user.id)
            .order_by(Booking.created_at.desc())
            .limit(5)
        )
        .scalars()
        .all()
    )
    return {
        "active_listings": count_requests(("open", "offer_selected", "draft")),
        "incoming_offers": incoming_offers,
        "upcoming_pickups": upcoming,
        "ongoing_collections": ongoing,
        "completed_transactions": completed,
        "total_earnings": decimal_str(q2(earnings)),
        "pending_settlements": pending_settlements,
        "unread_notifications": unread_count(db, user.id),
        "recent_bookings": [
            {
                "id": b.id,
                "reference": b.reference,
                "status": b.status,
                "scheduled_date": b.scheduled_date,
                "accepted_payout": decimal_str(b.accepted_payout),
            }
            for b in recent_bookings
        ],
    }

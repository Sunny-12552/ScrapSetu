"""Dealer onboarding, profile management, and dashboard."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.constants import DAY_KEYS, DEFAULT_OPERATING_HOURS, local_today
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.time import utcnow
from app.models import (
    Booking,
    BookingStatus,
    City,
    DealerCategory,
    DealerOffer,
    DealerProfile,
    DealerServiceArea,
    DealerStatus,
    DealerVerificationDocument,
    MaterialCategory,
    OfferStatus,
    PaymentStatus,
    RequestStatus,
    ScrapRequest,
    User,
    UserStatus,
)
from app.schemas import DealerApplication, DealerAvailabilityUpdate, DealerServiceAreaIn
from app.services import audit, notifications
from app.services.serializers import decimal_str
from app.services.settlement import q2


def dealer_query():
    return select(DealerProfile).options(
        selectinload(DealerProfile.user),
        selectinload(DealerProfile.city),
        selectinload(DealerProfile.categories).selectinload(DealerCategory.category),
        selectinload(DealerProfile.service_areas).selectinload(DealerServiceArea.city),
        selectinload(DealerProfile.documents),
    )


def load_dealer(db: Session, dealer_id: str) -> DealerProfile:
    dealer = db.execute(
        dealer_query()
        .where(DealerProfile.id == dealer_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if not dealer:
        raise NotFoundError("Dealer profile not found.")
    return dealer


def get_or_create_dealer(db: Session, user: User) -> DealerProfile:
    existing = db.execute(
        select(DealerProfile).where(DealerProfile.user_id == user.id)
    ).scalar_one_or_none()
    if existing:
        return load_dealer(db, existing.id)
    return None  # type: ignore[return-value]


def _validate_hours(hours: dict[str, dict]) -> dict[str, dict]:
    normalized: dict[str, dict] = {}
    for day in DAY_KEYS:
        value = hours.get(day) or DEFAULT_OPERATING_HOURS[day]
        closed = bool(value.get("closed", False))
        open_time = str(value.get("open", "08:00"))
        close_time = str(value.get("close", "20:00"))
        try:
            from datetime import time

            o = time.fromisoformat(open_time)
            c = time.fromisoformat(close_time)
        except ValueError as exc:
            raise ValidationError(f"Invalid operating hours for {day}.") from exc
        if not closed and c <= o:
            raise ValidationError(f"Closing time must be after opening time on {day}.")
        normalized[day] = {
            "open": o.strftime("%H:%M"),
            "close": c.strftime("%H:%M"),
            "closed": closed,
        }
    return normalized


def apply_application(
    db: Session,
    user: User,
    payload: DealerApplication,
    *,
    http_request: Request | None = None,
) -> DealerProfile:
    if user.role != "dealer":
        raise ForbiddenError("Only dealer accounts can submit a dealer application.")
    city = db.get(City, payload.city_id)
    if not city or not city.is_active:
        raise ValidationError("Choose an active city.")

    categories = db.execute(
        select(MaterialCategory).where(MaterialCategory.id.in_(payload.category_ids))
    ).scalars().all()
    if len(categories) != len(set(payload.category_ids)):
        raise ValidationError("One or more selected material categories are invalid.")
    inactive = [c.name for c in categories if not c.is_active]
    if inactive:
        raise ValidationError("These categories are inactive: " + ", ".join(inactive))

    profile = db.execute(
        select(DealerProfile).where(DealerProfile.user_id == user.id)
    ).scalar_one_or_none()
    before_status = profile.status if profile else None
    if profile and profile.status == DealerStatus.APPROVED:
        raise ConflictError(
            "Your dealer profile is verified. Contact support to change business details."
        )
    if profile and profile.status == DealerStatus.SUSPENDED:
        raise ConflictError("Your dealer account is suspended. Contact support.")

    if not profile:
        profile = DealerProfile(
            user_id=user.id,
            business_name=payload.business_name,
            contact_person=payload.contact_person,
            city_id=payload.city_id,
        )
        db.add(profile)
        db.flush()

    profile.business_name = payload.business_name
    profile.legal_name = payload.legal_name
    profile.contact_person = payload.contact_person
    profile.email = payload.email
    profile.gstin = payload.gstin
    profile.pan = payload.pan
    profile.address_line = payload.address_line
    profile.city_id = payload.city_id
    profile.locality = payload.locality
    profile.postal_code = payload.postal_code
    profile.description = payload.description
    profile.min_collection_kg = payload.min_collection_kg
    profile.status = DealerStatus.SUBMITTED
    profile.accepts_new_requests = False
    profile.rejection_reason = None

    db.execute(
        DealerCategory.__table__.delete().where(DealerCategory.dealer_id == profile.id)
    )
    for category in categories:
        db.add(DealerCategory(dealer_id=profile.id, category_id=category.id))

    if payload.service_areas:
        db.execute(
            DealerServiceArea.__table__.delete().where(
                DealerServiceArea.dealer_id == profile.id
            )
        )
        seen = set()
        for area in payload.service_areas:
            locality = area.strip()
            key = locality.lower()
            if key in seen:
                continue
            seen.add(key)
            db.add(
                DealerServiceArea(
                    dealer_id=profile.id,
                    city_id=payload.city_id,
                    locality=locality or None,
                    pincode_prefixes=[],
                )
            )
    elif not profile.service_areas:
        db.add(
            DealerServiceArea(
                dealer_id=profile.id,
                city_id=payload.city_id,
                locality=None,
                pincode_prefixes=[],
            )
        )

    if not profile.operating_hours:
        profile.operating_hours = DEFAULT_OPERATING_HOURS

    audit.record(
        db,
        actor=user,
        action="dealer.application_submitted",
        entity_type="dealer_profile",
        entity_id=profile.id,
        before={"status": before_status} if before_status else None,
        after={"status": profile.status, "categories": len(categories)},
        request=http_request,
    )
    db.commit()
    return load_dealer(db, profile.id)


def set_service_areas(
    db: Session,
    dealer: DealerProfile,
    areas: list[DealerServiceAreaIn],
    *,
    actor: User,
    http_request: Request | None = None,
) -> DealerProfile:
    if dealer.status in (DealerStatus.SUSPENDED,):
        raise ConflictError("Suspended dealers cannot change service areas.")
    if not areas:
        raise ValidationError("Add at least one service area.")
    for area in areas:
        city = db.get(City, area.city_id)
        if not city or not city.is_active:
            raise ValidationError("One or more cities are not served.")
    db.execute(
        DealerServiceArea.__table__.delete().where(DealerServiceArea.dealer_id == dealer.id)
    )
    for area in areas:
        db.add(
            DealerServiceArea(
                dealer_id=dealer.id,
                city_id=area.city_id,
                locality=area.locality.strip() if area.locality else None,
                pincode_prefixes=area.pincode_prefixes,
            )
        )
    audit.record(
        db, actor=actor, action="dealer.service_areas_updated",
        entity_type="dealer_profile", entity_id=dealer.id,
        after={"areas": [a.model_dump() for a in areas]}, request=http_request,
    )
    db.commit()
    return load_dealer(db, dealer.id)


def set_categories(
    db: Session,
    dealer: DealerProfile,
    category_ids: list[str],
    *,
    actor: User,
    http_request: Request | None = None,
) -> DealerProfile:
    if not category_ids:
        raise ValidationError("Select at least one material category.")
    categories = db.execute(
        select(MaterialCategory).where(MaterialCategory.id.in_(category_ids))
    ).scalars().all()
    if len(categories) != len(set(category_ids)):
        raise ValidationError("One or more categories are invalid.")
    if any(not c.is_active for c in categories):
        raise ValidationError("Inactive categories cannot be selected.")
    current = {link.category_id for link in dealer.categories}
    for category_id in current - set(category_ids):
        db.execute(
            DealerCategory.__table__.delete().where(
                DealerCategory.dealer_id == dealer.id,
                DealerCategory.category_id == category_id,
            )
        )
    for category_id in set(category_ids) - current:
        db.add(DealerCategory(dealer_id=dealer.id, category_id=category_id))
    audit.record(
        db, actor=actor, action="dealer.categories_updated",
        entity_type="dealer_profile", entity_id=dealer.id,
        after={"category_ids": category_ids}, request=http_request,
    )
    db.commit()
    return load_dealer(db, dealer.id)


def update_availability(
    db: Session,
    dealer: DealerProfile,
    payload: DealerAvailabilityUpdate,
    *,
    actor: User,
    http_request: Request | None = None,
) -> DealerProfile:
    if dealer.status != DealerStatus.APPROVED:
        raise ConflictError("Verification is required before changing availability.")
    if payload.accepts_new_requests is not None:
        dealer.accepts_new_requests = payload.accepts_new_requests
    if payload.operating_hours is not None:
        dealer.operating_hours = _validate_hours(payload.operating_hours)
    audit.record(
        db, actor=actor, action="dealer.availability_updated",
        entity_type="dealer_profile", entity_id=dealer.id,
        after={
            "accepts_new_requests": dealer.accepts_new_requests,
            "operating_hours": dealer.operating_hours,
        },
        request=http_request,
    )
    db.commit()
    return load_dealer(db, dealer.id)


def add_document(
    db: Session,
    dealer: DealerProfile,
    *,
    actor: User,
    doc_type: str,
    stored_key: str,
    file_name: str,
    mime_type: str,
    size_bytes: int,
) -> DealerProfile:
    if dealer.status == DealerStatus.APPROVED:
        raise ConflictError("Verified dealers cannot add new verification documents online.")
    db.add(
        DealerVerificationDocument(
            dealer_id=dealer.id,
            doc_type=doc_type,
            file_key=stored_key,
            file_name=file_name[:255],
            mime_type=mime_type,
            size_bytes=size_bytes,
            status="pending",
        )
    )
    audit.record(
        db, actor=actor, action="dealer.document_uploaded",
        entity_type="dealer_profile", entity_id=dealer.id,
        after={"doc_type": doc_type, "file": file_name},
    )
    db.commit()
    return load_dealer(db, dealer.id)


def delete_document(
    db: Session, dealer: DealerProfile, document_id: str, *, actor: User
) -> DealerProfile:
    doc = db.get(DealerVerificationDocument, document_id)
    if not doc or doc.dealer_id != dealer.id:
        raise NotFoundError("Document not found.")
    if dealer.status == DealerStatus.APPROVED:
        raise ConflictError("Verified dealer documents cannot be removed online.")
    from app.integrations.storage import delete_object

    delete_object(doc.file_key)
    db.delete(doc)
    audit.record(
        db, actor=actor, action="dealer.document_deleted",
        entity_type="dealer_profile", entity_id=dealer.id,
        before={"document_id": document_id, "doc_type": doc.doc_type},
    )
    db.commit()
    return load_dealer(db, dealer.id)


def dashboard(db: Session, dealer: DealerProfile) -> dict:
    from app.services.matching import available_requests_for_dealer
    from app.services.notifications import unread_count

    available = available_requests_for_dealer(db, dealer, limit=100)
    pending_offers = int(
        db.execute(
            select(func.count(DealerOffer.id)).where(
                DealerOffer.dealer_id == dealer.id,
                DealerOffer.status == OfferStatus.SUBMITTED.value,
            )
        ).scalar_one()
    )
    accepted_jobs = int(
        db.execute(
            select(func.count(Booking.id)).where(
                Booking.dealer_id == dealer.id,
                Booking.status.in_(
                    [
                        BookingStatus.OFFER_SELECTED.value,
                        BookingStatus.BOOKING_CONFIRMED.value,
                    ]
                ),
            )
        ).scalar_one()
    )
    todays_pickups = int(
        db.execute(
            select(func.count(Booking.id)).where(
                Booking.dealer_id == dealer.id,
                Booking.status == BookingStatus.BOOKING_CONFIRMED.value,
                Booking.scheduled_date == local_today(),
            )
        ).scalar_one()
    )
    completed = int(
        db.execute(
            select(func.count(Booking.id)).where(
                Booking.dealer_id == dealer.id,
                Booking.status == BookingStatus.COMPLETED.value,
            )
        ).scalar_one()
    )
    earnings = db.execute(
        select(func.coalesce(func.sum(Booking.accepted_payout), 0)).where(
            Booking.dealer_id == dealer.id,
            Booking.status == BookingStatus.COMPLETED.value,
        )
    ).scalar_one()
    total_closed = completed + dealer.cancelled_jobs
    cancellation_rate = (
        q2(Decimal(dealer.cancelled_jobs) / Decimal(total_closed) * Decimal("100"))
        if total_closed
        else Decimal("0.00")
    )
    return {
        "available_requests": len(available),
        "pending_offers": pending_offers,
        "accepted_jobs": accepted_jobs,
        "todays_pickups": todays_pickups,
        "completed_jobs": completed,
        "cancellation_rate": cancellation_rate,
        "rating_avg": decimal_str(dealer.rating_avg),
        "rating_count": dealer.rating_count,
        "recorded_earnings": decimal_str(q2(earnings)),
        "unread_notifications": unread_count(db, dealer.user_id),
    }


def dealer_bookings(db: Session, dealer: DealerProfile, status: str | None = None):
    stmt = select(Booking).where(Booking.dealer_id == dealer.id)
    if status:
        stmt = stmt.where(Booking.status == status)
    return (
        db.execute(stmt.order_by(Booking.created_at.desc()).limit(200)).scalars().all()
    )

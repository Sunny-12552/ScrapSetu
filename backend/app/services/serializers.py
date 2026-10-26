"""Model → API response serializers (kept out of route handlers)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from app.core.constants import TIME_WINDOW_LABELS
from app.core.security import mask_name, mask_phone
from app.core.time import utcnow
from app.models import (
    Booking,
    BookingStatus,
    DealerOffer,
    DealerProfile,
    MaterialCategory,
    PaymentRecord,
    ScrapImage,
    ScrapRequest,
    Settlement,
    SettlementStatus,
    User,
    UserProfile,
)
from app.services.state_machine import next_actions


def file_url(key: str | None) -> str | None:
    if not key:
        return None
    return f"/api/v1/files/{key}"


def decimal_str(value: Decimal | None) -> str | None:
    """Serialize money/weight without float rounding.

    Pydantic's JSON mode renders ``Decimal`` as a string; doing the same in
    hand-built response dicts keeps every endpoint consistent and preserves
    paise/gram precision all the way to the browser.
    """
    return format(value, "f") if value is not None else None


def user_brief(user: User) -> dict:
    profile = user.profile
    return {
        "id": user.id,
        "role": user.role,
        "phone_masked": mask_phone(user.phone),
        "name": profile.full_name if profile else None,
        "status": user.status,
        "locale": user.locale,
    }


def profile_read(profile: UserProfile | None) -> dict:
    return {
        "user_id": profile.user_id if profile else "",
        "full_name": profile.full_name if profile else None,
        "email": profile.email if profile else None,
        "preferred_language": profile.preferred_language if profile else "en",
    }


def dealer_public(profile: DealerProfile) -> dict:
    verified = profile.status == "approved"
    city_name = profile.city.name if profile.city else None
    return {
        "id": profile.id,
        "business_name": profile.business_name,
        "locality": profile.locality,
        "city_name": city_name,
        "verified": verified,
        "status": profile.status,
        "rating_avg": decimal_str(profile.rating_avg),
        "rating_count": profile.rating_count,
        "completed_jobs": profile.completed_jobs,
        "min_collection_kg": decimal_str(profile.min_collection_kg),
        "description": profile.description,
    }


def dealer_detail(dealer: DealerProfile) -> dict:
    return {
        **dealer_public(dealer),
        "city_id": dealer.city_id,
        "accepts_new_requests": dealer.accepts_new_requests,
        "operating_hours": dealer.operating_hours,
        "verification_notes": dealer.verification_notes,
        "rejection_reason": dealer.rejection_reason,
        "gstin": dealer.gstin,
        "pan": dealer.pan,
        "legal_name": dealer.legal_name,
        "contact_person": dealer.contact_person,
        "email": dealer.email,
        "address_line": dealer.address_line,
        "postal_code": dealer.postal_code,
        "cancelled_jobs": dealer.cancelled_jobs,
        "categories": [
            category_brief(link.category) for link in dealer.categories if link.category
        ],
        "service_areas": [
            {
                "id": area.id,
                "city_id": area.city_id,
                "city_name": area.city.name if area.city else None,
                "locality": area.locality,
                "pincode_prefixes": area.pincode_prefixes or [],
            }
            for area in dealer.service_areas
        ],
        "documents": [
            {
                "id": doc.id,
                "doc_type": doc.doc_type,
                "file_name": doc.file_name,
                "mime_type": doc.mime_type,
                "size_bytes": doc.size_bytes,
                "status": doc.status,
                "review_notes": doc.review_notes,
                "created_at": doc.created_at,
            }
            for doc in dealer.documents
        ],
    }


def category_brief(category: MaterialCategory) -> dict:
    return {
        "id": category.id,
        "slug": category.slug,
        "name": category.name,
        "description": category.description,
        "unit": category.unit,
        "icon": category.icon,
        "is_active": category.is_active,
        "requires_special_handling": category.requires_special_handling,
        "sort_order": category.sort_order,
    }


def image_read(image: ScrapImage) -> dict:
    return {
        "id": image.id,
        "url": file_url(image.object_key),
        "width": image.width,
        "height": image.height,
        "size_bytes": image.size_bytes,
        "mime_type": image.mime_type,
    }


def request_read(request: ScrapRequest, *, include_address: bool = False) -> dict:
    booked = request.booking
    accepted_offer_id = booked.offer_id if booked else None
    payload = {
        "id": request.id,
        "reference": request.reference,
        "status": request.status,
        "city_id": request.city_id,
        "locality": request.locality,
        "postal_code": request.postal_code,
        "preferred_date": request.preferred_date,
        "time_window": request.time_window,
        "estimated_total_weight_kg": decimal_str(request.estimated_total_weight_kg),
        "customer_notes": request.customer_notes,
        "offer_count": request.offer_count,
        "items": [
            {
                "id": item.id,
                "category_id": item.category_id,
                "category_name": item.category.name if item.category else None,
                "category_slug": item.category.slug if item.category else None,
                "estimated_weight_kg": decimal_str(item.estimated_weight_kg),
                "estimated_quantity": decimal_str(item.estimated_quantity),
                "quantity_unit": item.quantity_unit,
                "condition_notes": item.condition_notes,
            }
            for item in sorted(request.items, key=lambda i: i.created_at)
        ],
        "images": [
            image_read(image)
            for image in sorted(request.images, key=lambda i: i.sort_order)
            if image.deleted_at is None
        ],
        "created_at": request.created_at,
        "published_at": request.published_at,
        "expires_at": request.expires_at,
        "booking_id": booked.id if booked else None,
        "accepted_offer_id": accepted_offer_id,
        "time_window_label": TIME_WINDOW_LABELS.get(request.time_window, request.time_window),
    }
    if include_address:
        payload["address"] = request.address_snapshot
    return payload


def offer_read(offer: DealerOffer, *, now: datetime | None = None) -> dict:
    now = now or utcnow()
    expired = offer.valid_until <= now
    request = offer.request
    return {
        "id": offer.id,
        "request_id": offer.request_id,
        "version": offer.version,
        "status": offer.status,
        "estimated_payout": decimal_str(offer.estimated_payout),
        "min_total_weight_kg": decimal_str(offer.min_total_weight_kg),
        "pickup_date": offer.pickup_date,
        "pickup_window": offer.pickup_window,
        "pickup_window_label": TIME_WINDOW_LABELS.get(offer.pickup_window, offer.pickup_window),
        "valid_until": offer.valid_until,
        "conditions": offer.conditions,
        "disclosure": offer.disclosure,
        "created_at": offer.created_at,
        "dealer": dealer_public(offer.dealer),
        "items": [
            {
                "id": item.id,
                "category_id": item.category_id,
                "category_name": item.category.name if item.category else None,
                "rate_per_kg": decimal_str(item.rate_per_kg),
                "estimated_weight_kg": decimal_str(item.estimated_weight_kg),
                "line_total": decimal_str(item.line_total),
                "notes": item.notes,
            }
            for item in offer.items
        ],
        "is_expired": expired,
        "is_selectable": (
            offer.status == "submitted"
            and not expired
            and request is not None
            and request.status == "open"
        ),
    }


def _settlement_items(settlement: Settlement) -> list[dict]:
    return [
        {
            "id": item.id,
            "category_id": item.category_id,
            "category_name": item.category.name if item.category else "Material",
            "actual_weight_kg": decimal_str(item.actual_weight_kg),
            "accepted_rate_per_kg": decimal_str(item.accepted_rate_per_kg),
            "final_rate_per_kg": decimal_str(item.final_rate_per_kg),
            "line_total": decimal_str(item.line_total),
            "rate_changed": item.rate_changed,
            "change_reason": item.change_reason,
            "customer_consent_required": item.customer_consent_required,
            "customer_consent": item.customer_consent,
        }
        for item in settlement.items
    ]


def _measured_items(booking: Booking) -> list[dict]:
    """Recorded scale readings, shaped like settlement items for the UI.

    Before a settlement exists the dealer still needs the measured weights
    when submitting one; without this the form would silently fall back to
    the customer's estimate.
    """
    return [
        {
            "id": m.id,
            "category_id": m.category_id,
            "category_name": m.category.name if m.category else "Material",
            "actual_weight_kg": decimal_str(m.actual_weight_kg),
            "accepted_rate_per_kg": decimal_str(m.rate_per_kg),
            "final_rate_per_kg": decimal_str(m.rate_per_kg),
            "line_total": decimal_str(m.line_total),
            "rate_changed": False,
            "change_reason": None,
            "customer_consent_required": False,
            "customer_consent": None,
        }
        for m in booking.measured_items
    ]


def payment_read(payment: PaymentRecord) -> dict:
    return {
        "id": payment.id,
        "method": payment.method,
        "amount": decimal_str(payment.amount),
        "status": payment.status,
        # ScrapSetu never sees a gateway callback; amounts are recorded by the
        # dealer and confirmed by the customer. This flag is always false.
        "gateway_verified": False,
        "upi_reference": payment.upi_reference,
        "payer_note": payment.payer_note,
        "recorded_at": payment.recorded_at,
        "customer_confirmed_at": payment.customer_confirmed_at,
        "verified_at": payment.verified_at,
    }


def settlement_read(settlement: Settlement | None) -> dict | None:
    if settlement is None:
        return None
    # The stored breakdown is a point-in-time document. Administrators can
    # revise a payout by creating a new settlement version, so keep the money
    # fields on the breakdown in sync with the authoritative row values.
    calculation = settlement.calculation
    if isinstance(calculation, dict):
        calculation = {
            **calculation,
            "gross": decimal_str(settlement.gross_amount),
            "deductions": decimal_str(settlement.deductions),
            "adjustments": decimal_str(settlement.adjustments),
            "platform_fee": decimal_str(settlement.platform_fee),
            "final_payout": decimal_str(settlement.final_payout),
        }
    return {
        "id": settlement.id,
        "version": settlement.version,
        "status": settlement.status,
        "gross_amount": decimal_str(settlement.gross_amount),
        "deductions": decimal_str(settlement.deductions),
        "adjustments": decimal_str(settlement.adjustments),
        "platform_fee": decimal_str(settlement.platform_fee),
        "final_payout": decimal_str(settlement.final_payout),
        "deduction_reason": settlement.deduction_reason,
        "notes": settlement.notes,
        "submitted_at": settlement.submitted_at,
        "customer_confirmed_at": settlement.customer_confirmed_at,
        "items": _settlement_items(settlement),
        "payments": [payment_read(p) for p in settlement.payments],
        "calculation": calculation,
    }


def _address_for(booking: Booking, viewer_role: str) -> dict | None:
    request = booking.request
    snapshot = request.address_snapshot or {}
    if viewer_role == "customer" or viewer_role == "admin":
        return snapshot
    if viewer_role == "dealer" and booking.status in {
        BookingStatus.BOOKING_CONFIRMED,
        BookingStatus.PICKUP_IN_PROGRESS,
        BookingStatus.WEIGHING_RECORDED,
        BookingStatus.SETTLEMENT_PENDING,
        BookingStatus.COMPLETED,
        BookingStatus.DISPUTED,
    }:
        return snapshot
    return None


def booking_read(booking: Booking, *, viewer_role: str, evidence: list[dict] | None = None) -> dict:
    latest_settlement = booking.settlements[-1] if booking.settlements else None
    request = booking.request
    dealer_can_see_contact = booking.status in {
        BookingStatus.BOOKING_CONFIRMED,
        BookingStatus.PICKUP_IN_PROGRESS,
        BookingStatus.WEIGHING_RECORDED,
        BookingStatus.SETTLEMENT_PENDING,
        BookingStatus.DISPUTED,
        BookingStatus.COMPLETED,
    }
    customer_profile = booking.customer.profile if booking.customer else None
    customer_name = customer_profile.full_name if customer_profile else None
    snapshot = dict(booking.snapshot.payload) if booking.snapshot else {}
    if booking.snapshot:
        snapshot.setdefault("snapshot_id", booking.snapshot.id)
        snapshot["offer_version"] = booking.snapshot.offer_version
        snapshot.setdefault("accepted_at", booking.snapshot.created_at.isoformat())
    open_dispute = next(
        (d for d in booking.disputes if d.status in ("open", "under_review")), None
    )
    dealer_payload = dealer_public(booking.dealer)
    if viewer_role in {"customer", "admin"} and booking.dealer and booking.dealer.user:
        dealer_payload["phone"] = booking.dealer.user.phone
    return {
        "id": booking.id,
        "reference": booking.reference,
        "request_id": booking.request_id,
        "request_reference": request.reference if request else "",
        "status": booking.status,
        "scheduled_date": booking.scheduled_date,
        "time_window": booking.time_window,
        "time_window_label": TIME_WINDOW_LABELS.get(booking.time_window, booking.time_window),
        "accepted_payout": decimal_str(booking.accepted_payout),
        "created_at": booking.created_at,
        "confirmed_at": booking.confirmed_at,
        "pickup_started_at": booking.pickup_started_at,
        "weighing_recorded_at": booking.weighing_recorded_at,
        "completed_at": booking.completed_at,
        "cancelled_at": booking.cancelled_at,
        "cancellation_reason": booking.cancellation_reason,
        "customer": {
            "name": customer_name if (viewer_role != "dealer" or dealer_can_see_contact) else mask_name(customer_name),
            "phone": (
                booking.customer.phone
                if (viewer_role != "dealer" or dealer_can_see_contact)
                else None
            ),
        },
        "dealer": dealer_payload,
        "address": _address_for(booking, viewer_role),
        "materials": [
            item.category.name for item in request.items if item.category
        ]
        if request
        else [],
        "settlement": settlement_read(latest_settlement),
        "latest_settlement": settlement_read(latest_settlement),
        "payments": [payment_read(p) for p in booking.payments],
        "history": [
            {
                "from_status": h.from_status,
                "to_status": h.to_status,
                "actor_role": h.actor_role,
                "reason": h.reason,
                "created_at": h.created_at,
            }
            for h in booking.history
        ],
        "measurements": (
            _settlement_items(latest_settlement)
            if latest_settlement
            else _measured_items(booking)
        ),
        "evidence": evidence or [],
        "allowed_actions": next_actions(booking, viewer_role),
        "has_review": booking.review is not None,
        "open_dispute_id": open_dispute.id if open_dispute else None,
        "offer_snapshot": snapshot,
    }


def booking_summary(booking: Booking) -> dict:
    return {
        "id": booking.id,
        "reference": booking.reference,
        "request_id": booking.request_id,
        "status": booking.status,
        "scheduled_date": booking.scheduled_date,
        "time_window": booking.time_window,
        "accepted_payout": decimal_str(booking.accepted_payout),
        "dealer_name": booking.dealer.business_name if booking.dealer else None,
        "locality": booking.request.locality if booking.request else None,
        "final_payout": (
            decimal_str(booking.settlements[-1].final_payout)
            if booking.settlements
            else None
        ),
        "created_at": booking.created_at,
    }



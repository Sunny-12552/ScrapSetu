"""Dealer eligibility, explainable ranking, and indicative payouts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import DAY_KEYS, DEFAULT_OPERATING_HOURS, TIME_WINDOWS
from app.core.time import utcnow
from app.models import (
    Booking,
    BookingStatus,
    DealerOffer,
    DealerOfferItem,
    DealerProfile,
    DealerServiceArea,
    MaterialPriceReference,
    OfferStatus,
    ScrapRequest,
    User,
    UserStatus,
)
from app.services.settlement import indicative_payout, money, q2

MATCH_WEIGHTS = {
    "service_area": 30,
    "availability": 20,
    "reliability": 25,
    "rating": 15,
    "payout": 10,
}

ACTIVE_BOOKING_STATUSES = {
    BookingStatus.BOOKING_CONFIRMED,
    BookingStatus.PICKUP_IN_PROGRESS,
    BookingStatus.WEIGHING_RECORDED,
    BookingStatus.SETTLEMENT_PENDING,
    BookingStatus.OFFER_SELECTED,
}


@dataclass
class Candidate:
    dealer: DealerProfile
    area_level: str
    area_score: int
    payout_estimate: Decimal
    reliability: float
    score: float = 0.0
    breakdown: dict | None = None


def _normalise(value: str | None) -> str:
    return (value or "").strip().lower()


def area_match(dealer: DealerProfile, request: ScrapRequest) -> tuple[bool, str, int]:
    """Return (matches, specificity label, score 0-30)."""
    best = (False, "none", 0)
    for area in dealer.service_areas:
        if area.city_id != request.city_id:
            continue
        pincode_match = any(
            request.postal_code.startswith(str(prefix))
            for prefix in (area.pincode_prefixes or [])
        )
        locality_match = bool(area.locality) and _normalise(area.locality) == _normalise(
            request.locality
        )
        if area.locality and not locality_match and not pincode_match:
            continue
        if locality_match:
            return True, "locality", MATCH_WEIGHTS["service_area"]
        if pincode_match:
            best = (True, "pincode", 22)
        elif not area.locality:
            best = (True, "city", 12)
    return best


def operating_hours_for(dealer: DealerProfile) -> dict:
    hours = dealer.operating_hours or {}
    if not hours:
        return DEFAULT_OPERATING_HOURS
    return hours


def availability_match(
    dealer: DealerProfile, request: ScrapRequest
) -> tuple[bool, str]:
    if not dealer.accepts_new_requests:
        return False, "Dealer has paused new requests."
    day_key = DAY_KEYS[request.preferred_date.weekday()]
    hours = operating_hours_for(dealer).get(day_key, {})
    if hours.get("closed"):
        return False, "Dealer is closed on the requested day."
    try:
        open_t = time.fromisoformat(str(hours.get("open", "08:00")))
        close_t = time.fromisoformat(str(hours.get("close", "20:00")))
    except ValueError:
        return False, "Dealer operating hours are invalid."
    start_hour, end_hour = TIME_WINDOWS.get(request.time_window, (8, 11))
    window_start = time(start_hour, 0)
    window_end = time(end_hour, 0)
    if window_start < open_t or window_end > close_t:
        return False, "Requested window is outside the dealer's operating hours."
    return True, "Available during the requested window."


def has_conflict(db: Session, dealer: DealerProfile, request: ScrapRequest) -> bool:
    conflict = db.execute(
        select(Booking.id).where(
            Booking.dealer_id == dealer.id,
            Booking.scheduled_date == request.preferred_date,
            Booking.time_window == request.time_window,
            Booking.status.in_([s.value for s in ACTIVE_BOOKING_STATUSES]),
        )
    ).first()
    return conflict is not None


def active_category_ids(request: ScrapRequest) -> set[str]:
    return {item.category_id for item in request.items}


def dealer_category_ids(dealer: DealerProfile) -> set[str]:
    return {link.category_id for link in dealer.categories}


def request_weight(request: ScrapRequest) -> Decimal:
    if request.estimated_total_weight_kg is not None:
        return request.estimated_total_weight_kg
    total = sum(
        (item.estimated_weight_kg or Decimal("0") for item in request.items),
        Decimal("0"),
    )
    return total


def price_reference(
    db: Session, category_id: str, city_id: str, on: date
) -> MaterialPriceReference | None:
    stmt = (
        select(MaterialPriceReference)
        .where(
            MaterialPriceReference.category_id == category_id,
            MaterialPriceReference.effective_from <= on,
        )
        .order_by(MaterialPriceReference.effective_from.desc())
    )
    rows = db.execute(stmt).scalars().all()
    for row in rows:
        if row.effective_to is not None and row.effective_to < on:
            continue
        if row.city_id == city_id:
            return row
    for row in rows:
        if row.effective_to is not None and row.effective_to < on:
            continue
        if row.city_id is None:
            return row
    return None


def dealer_recent_rates(db: Session, dealer_id: str) -> dict[str, Decimal]:
    rows = db.execute(
        select(DealerOfferItem.category_id, DealerOfferItem.rate_per_kg)
        .join(DealerOffer, DealerOffer.id == DealerOfferItem.offer_id)
        .where(
            DealerOffer.dealer_id == dealer_id,
            DealerOffer.status == OfferStatus.ACCEPTED,
        )
        .order_by(DealerOffer.created_at.desc())
        .limit(200)
    ).all()
    rates: dict[str, Decimal] = {}
    for category_id, rate in rows:
        rates.setdefault(category_id, rate)
    return rates


def payout_estimate(
    db: Session, dealer: DealerProfile, request: ScrapRequest
) -> Decimal:
    rates = dealer_recent_rates(db, dealer.id)
    lines: list[tuple[Decimal, Decimal]] = []
    for item in request.items:
        weight = item.estimated_weight_kg or Decimal("0")
        if weight <= 0:
            continue
        rate = rates.get(item.category_id)
        if rate is None:
            ref = price_reference(db, item.category_id, request.city_id, request.preferred_date)
            rate = (ref.indicative_min_rate + ref.indicative_max_rate) / Decimal("2") if ref else Decimal("0")
        lines.append((weight, rate))
    return indicative_payout(lines)


def reliability(dealer: DealerProfile) -> float:
    completed = dealer.completed_jobs
    cancelled = dealer.cancelled_jobs
    # Laplace smoothing avoids 1.0 for a brand-new dealer.
    return (completed + 2) / (completed + cancelled + 4)


def rating_score(dealer: DealerProfile) -> float:
    if dealer.rating_count == 0:
        return 0.6
    confidence = min(1.0, dealer.rating_count / 10)
    observed = float(money(dealer.rating_avg)) / 5
    return (1 - confidence) * 0.6 + confidence * observed


def eligible_dealers(
    db: Session, request: ScrapRequest, *, limit: int = 25
) -> tuple[list[Candidate], list[dict]]:
    """Return ranked eligible dealers plus per-dealer exclusion reasons."""
    candidates: list[Candidate] = []
    excluded: list[dict] = []
    required_categories = active_category_ids(request)
    weight = request_weight(request)
    dealers = (
        db.execute(
            select(DealerProfile)
            .join(User, User.id == DealerProfile.user_id)
            .where(
                DealerProfile.status == "approved",
                User.status == UserStatus.ACTIVE,
            )
        )
        .scalars()
        .all()
    )
    for dealer in dealers:
        reasons: list[str] = []
        ok, area_level, area_score = area_match(dealer, request)
        if not ok:
            reasons.append("Outside the dealer's service area.")
        available, availability_reason = availability_match(dealer, request)
        if not available:
            reasons.append(availability_reason)
        missing = required_categories - dealer_category_ids(dealer)
        if missing:
            reasons.append(f"Dealer does not handle {len(missing)} requested material(s).")
        if weight < dealer.min_collection_kg:
            reasons.append(
                f"Below the dealer's minimum collection of {dealer.min_collection_kg} kg."
            )
        if has_conflict(db, dealer, request):
            reasons.append("Dealer already has a pickup in this window.")
        if reasons:
            excluded.append({"dealer_id": dealer.id, "reasons": reasons})
            continue
        candidates.append(
            Candidate(
                dealer=dealer,
                area_level=area_level,
                area_score=area_score,
                payout_estimate=payout_estimate(db, dealer, request),
                reliability=reliability(dealer),
            )
        )

    max_payout = max((c.payout_estimate for c in candidates), default=Decimal("0"))
    for candidate in candidates:
        payout_component = (
            float(candidate.payout_estimate / max_payout) if max_payout > 0 else 0.5
        )
        rating_component = rating_score(candidate.dealer)
        score = (
            candidate.area_score
            + MATCH_WEIGHTS["availability"]
            + MATCH_WEIGHTS["reliability"] * candidate.reliability
            + MATCH_WEIGHTS["rating"] * rating_component
            + MATCH_WEIGHTS["payout"] * payout_component
        )
        candidate.score = round(score, 2)
        candidate.breakdown = {
            "service_area": round(candidate.area_score, 2),
            "availability": MATCH_WEIGHTS["availability"],
            "reliability": round(MATCH_WEIGHTS["reliability"] * candidate.reliability, 2),
            "rating": round(MATCH_WEIGHTS["rating"] * rating_component, 2),
            "payout": round(MATCH_WEIGHTS["payout"] * payout_component, 2),
            "total": candidate.score,
            "area_level": candidate.area_level,
            "explanation": (
                f"Service area ({candidate.area_level}), available in the requested window, "
                f"{candidate.dealer.completed_jobs} completed jobs, "
                f"rating {candidate.dealer.rating_avg} from {candidate.dealer.rating_count} reviews, "
                f"indicative payout ₹{q2(candidate.payout_estimate)}."
            ),
        }
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[:limit], excluded


def dealer_eligible_for_request(
    db: Session, dealer: DealerProfile, request: ScrapRequest
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if dealer.status != "approved":
        reasons.append("Dealer account is not approved.")
    if dealer.user.status != UserStatus.ACTIVE:
        reasons.append("Dealer account is not active.")
    if not dealer.accepts_new_requests:
        reasons.append("Dealer has paused new requests.")
    ok, _, _ = area_match(dealer, request)
    if not ok:
        reasons.append("Request is outside the dealer's service area.")
    available, availability_reason = availability_match(dealer, request)
    if not available:
        reasons.append(availability_reason)
    missing = active_category_ids(request) - dealer_category_ids(dealer)
    if missing:
        reasons.append("Dealer does not handle every requested material.")
    if request_weight(request) < dealer.min_collection_kg:
        reasons.append("Request is below the dealer's minimum collection quantity.")
    if has_conflict(db, dealer, request):
        reasons.append("Dealer already has a booking in this window.")
    return not reasons, reasons


def available_requests_for_dealer(
    db: Session,
    dealer: DealerProfile,
    *,
    category_id: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> list[dict]:
    now = utcnow()
    stmt = (
        select(ScrapRequest)
        .where(
            ScrapRequest.status == "open",
            ScrapRequest.city_id == dealer.city_id,
            ScrapRequest.deleted_at.is_(None),
        )
        .order_by(ScrapRequest.published_at.desc())
        .limit(200)
    )
    rows = db.execute(stmt).scalars().all()
    existing_offer_request_ids = set(
        db.execute(
            select(DealerOffer.request_id).where(
                DealerOffer.dealer_id == dealer.id,
                DealerOffer.status.in_(
                    [OfferStatus.SUBMITTED.value, OfferStatus.ACCEPTED.value]
                ),
            )
        )
        .scalars()
        .all()
    )
    results: list[dict] = []
    for request in rows:
        if request.expires_at and request.expires_at <= now:
            continue
        if request.id in existing_offer_request_ids:
            continue
        if category_id and category_id not in active_category_ids(request):
            continue
        eligible, _ = dealer_eligible_for_request(db, dealer, request)
        if not eligible:
            continue
        if search:
            haystack = f"{request.reference} {request.locality} {request.postal_code}".lower()
            if search.lower() not in haystack:
                continue
        results.append(
            {
                "id": request.id,
                "reference": request.reference,
                "locality": request.locality,
                "postal_code_masked": request.postal_code[:2] + "***",
                "city_name": request.city.name if request.city else "",
                "preferred_date": request.preferred_date,
                "time_window": request.time_window,
                "estimated_total_weight_kg": request.estimated_total_weight_kg,
                "materials": [
                    item.category.name for item in request.items if item.category
                ],
                "item_count": len(request.items),
                "image_count": len([i for i in request.images if i.deleted_at is None]),
                "has_offer": False,
                "created_at": request.created_at,
                "expires_at": request.expires_at,
            }
        )
        if len(results) >= limit:
            break
    return results


def suggest_dealers_for_request(db: Session, request: ScrapRequest) -> dict:
    candidates, excluded = eligible_dealers(db, request)
    return {
        "request_id": request.id,
        "ranked": [
            {
                "dealer_id": c.dealer.id,
                "business_name": c.dealer.business_name,
                "score": c.score,
                "breakdown": c.breakdown,
                "indicative_payout": c.payout_estimate,
            }
            for c in candidates
        ],
        "eligible_count": len(candidates),
        "excluded_count": len(excluded),
        "weights": MATCH_WEIGHTS,
    }

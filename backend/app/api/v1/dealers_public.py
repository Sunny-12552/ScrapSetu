"""Public dealer profile and reviews (visible to signed-in customers)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DbSession
from app.core.errors import NotFoundError
from app.models import User
from app.schemas import ReviewRead
from app.services import dealers as dealer_service
from app.services import engagement
from app.services.serializers import dealer_detail

router = APIRouter(prefix="/dealers", tags=["dealers"])


@router.get("/{dealer_id}/public")
def public_dealer(dealer_id: str, db: DbSession):
    dealer = dealer_service.load_dealer(db, dealer_id)
    if dealer.status != "approved":
        raise NotFoundError("Dealer not found.")
    data = dealer_detail(dealer)
    for field in ("documents", "gstin", "pan", "verification_notes", "rejection_reason"):
        data.pop(field, None)
    data["reviews"] = [
        {
            "rating": r.rating,
            "comment": r.comment,
            "created_at": r.created_at,
        }
        for r in engagement.dealer_reviews(db, dealer.id, limit=10)
    ]
    return data


@router.get("/{dealer_id}/reviews", response_model=list[ReviewRead])
def dealer_reviews(dealer_id: str, db: DbSession):
    dealer = dealer_service.load_dealer(db, dealer_id)
    if dealer.status != "approved":
        raise NotFoundError("Dealer not found.")
    rows = engagement.dealer_reviews(db, dealer.id)
    result = []
    for review in rows:
        customer = db.get(User, review.customer_id)
        name = customer.profile.full_name if customer and customer.profile else None
        parts = name.split() if name else []
        display = (
            f"{parts[0]} {parts[-1][0]}."
            if len(parts) > 1
            else (name or "Customer")
        )
        result.append(
            {
                "id": review.id,
                "booking_id": review.booking_id,
                "rating": review.rating,
                "comment": review.comment,
                "status": review.status,
                "created_at": review.created_at,
                "customer_name": display,
                "dealer_name": dealer.business_name,
            }
        )
    return result

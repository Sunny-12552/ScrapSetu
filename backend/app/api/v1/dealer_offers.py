"""Dealer offer creation, revision, withdrawal, and listing."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession, Paging, require_roles
from app.api.v1._common import serialize_booking
from app.core.errors import ForbiddenError, ValidationError
from app.core.time import utcnow
from app.models import (
    DealerOffer,
    DealerOfferItem,
    OfferStatus,
    Role,
    ScrapRequest,
)
from app.schemas import OfferCreate, OfferRead, OfferUpdate
from app.services import audit
from app.services import offers as offer_service
from app.services.bookings import get_dealer_profile
from app.services.serializers import offer_read

router = APIRouter(
    tags=["dealer-offers"],
    dependencies=[Depends(require_roles(Role.DEALER))],
)


@router.get("/dealer-offers")
def list_my_offers(
    db: DbSession,
    user: CurrentUser,
    paging: Paging,
    status: str | None = Query(default=None),
):
    dealer = get_dealer_profile(db, user)
    offer_service.expire_stale_offers(db)
    stmt = select(DealerOffer).where(DealerOffer.dealer_id == dealer.id)
    if status:
        if status not in {s.value for s in OfferStatus}:
            raise ValidationError("Unknown offer status filter.")
        stmt = stmt.where(DealerOffer.status == status)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            offer_service.offer_query()
            .where(DealerOffer.dealer_id == dealer.id, *([DealerOffer.status == status] if status else []))
            .order_by(DealerOffer.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    items = []
    for offer in rows:
        data = offer_read(offer)
        data["request_reference"] = offer.request.reference if offer.request else None
        items.append(data)
    return {
        "items": items,
        "total": total,
        "page": paging.page,
        "page_size": paging.page_size,
        "pages": max(1, (total + paging.page_size - 1) // paging.page_size),
    }


@router.post("/dealer-offers", response_model=OfferRead, status_code=201)
def create_offer(
    payload: OfferCreate, request: Request, db: DbSession, user: CurrentUser
):
    dealer = get_dealer_profile(db, user)
    offer = offer_service.create_offer(
        db, dealer, payload, actor_id=user.id, http_request=request
    )
    return offer_read(offer)


@router.get("/dealer-offers/{offer_id}", response_model=OfferRead)
def get_offer(offer_id: str, db: DbSession, user: CurrentUser):
    offer = offer_service.load_offer(db, offer_id)
    if user.role == "dealer":
        dealer = get_dealer_profile(db, user)
        if offer.dealer_id != dealer.id:
            raise ForbiddenError("This offer belongs to another dealer.")
    elif user.role == "customer":
        if offer.request.customer_id != user.id:
            raise ForbiddenError("This offer belongs to another customer's request.")
    return offer_read(offer)


@router.patch("/dealer-offers/{offer_id}", response_model=OfferRead)
def revise_offer(
    offer_id: str, payload: OfferUpdate, request: Request, db: DbSession, user: CurrentUser
):
    dealer = get_dealer_profile(db, user)
    offer = offer_service.load_offer(db, offer_id)
    if offer.dealer_id != dealer.id:
        raise ForbiddenError("This offer belongs to another dealer.")
    updated = offer_service.revise_offer(db, offer, payload, dealer=dealer)
    return offer_read(updated)


@router.post("/dealer-offers/{offer_id}/withdraw", response_model=OfferRead)
def withdraw_offer(offer_id: str, db: DbSession, user: CurrentUser):
    dealer = get_dealer_profile(db, user)
    offer = offer_service.load_offer(db, offer_id)
    if offer.dealer_id != dealer.id:
        raise ForbiddenError("This offer belongs to another dealer.")
    withdrawn = offer_service.withdraw_offer(db, offer, dealer=dealer)
    return offer_read(withdrawn)

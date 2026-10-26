"""Offer acceptance (customer) and offer detail access."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession, require_roles
from app.api.v1._common import remember, replay, serialize_booking
from app.core.errors import ForbiddenError, ValidationError
from app.models import Role, User
from app.schemas import OfferRead
from app.services import idempotency
from app.services import offers as offer_service
from app.services.bookings import get_dealer_profile
from app.services.serializers import offer_read

router = APIRouter(tags=["offers"])
customer_only = require_roles(Role.CUSTOMER)

# Accepting an offer is a critical exclusive operation: an Idempotency-Key is
# optional but strongly recommended by the client and honoured when supplied.


@router.post("/offers/{offer_id}/accept", dependencies=[Depends(customer_only)])
def accept_offer(
    offer_id: str, request: Request, db: DbSession, user: CurrentUser
):
    key = idempotency.check_key(request)
    payload = {"offer_id": offer_id}
    existing = replay(
        db, request, user, endpoint="offers.accept", payload=payload, key=key
    )
    if existing:
        return existing

    booking = offer_service.accept_offer(
        db, offer_id=offer_id, customer_id=user.id, http_request=request
    )
    body = serialize_booking(db, booking, "customer")
    remember(
        db, user, key=key, endpoint="offers.accept", payload=payload, body=body
    )
    return JSONResponse(status_code=200, content=body)


@router.get("/offers/{offer_id}", response_model=OfferRead)
def get_offer(offer_id: str, db: DbSession, user: CurrentUser):
    offer = offer_service.load_offer(db, offer_id)
    if user.role == "customer":
        if offer.request.customer_id != user.id:
            raise ForbiddenError("This offer belongs to another customer's request.")
    elif user.role == "dealer":
        dealer = get_dealer_profile(db, user)
        if offer.dealer_id != dealer.id:
            raise ForbiddenError("This offer belongs to another dealer.")
    return offer_read(offer)

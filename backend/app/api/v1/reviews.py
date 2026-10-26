"""Customer reviews and support tickets."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_roles
from app.core.errors import NotFoundError
from app.models import DealerProfile, Review, Role, User, UserReport
from app.schemas import (
    ReviewCreate,
    ReviewRead,
    SupportTicketCreate,
    SupportTicketRead,
    UserReportCreate,
)
from app.services import engagement

router = APIRouter(tags=["reviews", "support"])
customer_only = require_roles(Role.CUSTOMER)


@router.post(
    "/reviews",
    response_model=ReviewRead,
    status_code=201,
    dependencies=[Depends(customer_only)],
)
def create_review(payload: ReviewCreate, db: DbSession, user: CurrentUser):
    review = engagement.create_review(db, user, payload)
    dealer = db.get(DealerProfile, review.dealer_id)
    return {
        "id": review.id,
        "booking_id": review.booking_id,
        "rating": review.rating,
        "comment": review.comment,
        "status": review.status,
        "created_at": review.created_at,
        "customer_name": user.profile.full_name if user.profile else None,
        "dealer_name": dealer.business_name if dealer else None,
    }


def _review_row(db, review: Review, user: User) -> dict:
    dealer = db.get(DealerProfile, review.dealer_id)
    return {
        "id": review.id,
        "booking_id": review.booking_id,
        "rating": review.rating,
        "comment": review.comment,
        "status": review.status,
        "created_at": review.created_at,
        "customer_name": user.profile.full_name if user.profile else None,
        "dealer_name": dealer.business_name if dealer else None,
    }


@router.get("/customers/reviews", dependencies=[Depends(customer_only)])
def my_reviews(db: DbSession, user: CurrentUser):
    rows = (
        db.execute(
            select(Review)
            .where(Review.customer_id == user.id)
            .order_by(Review.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_review_row(db, r, user) for r in rows]


@router.post("/support/tickets", response_model=SupportTicketRead, status_code=201)
def create_ticket(payload: SupportTicketCreate, db: DbSession, user: CurrentUser):
    return engagement.create_support_ticket(db, user, payload)


@router.get("/support/tickets", response_model=list[SupportTicketRead])
def my_tickets(db: DbSession, user: CurrentUser):
    return engagement.user_support_tickets(db, user.id)


@router.post("/support/reports", status_code=201)
def report_user(payload: UserReportCreate, db: DbSession, user: CurrentUser):
    reported = db.get(User, payload.reported_user_id)
    if not reported or reported.id == user.id:
        raise NotFoundError("User not found.")
    report = UserReport(
        reporter_id=user.id,
        reported_user_id=payload.reported_user_id,
        reason=payload.reason,
        details=payload.details,
    )
    db.add(report)
    db.commit()
    return {"message": "Report submitted. Our team will review it."}

"""Dealer onboarding, discovery, availability, and workspace endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile

from app.api.deps import CurrentUser, DbSession, require_roles
from app.core.config import settings
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.models import Role, ScrapRequest
from app.schemas import (
    CategorySelection,
    DealerApplication,
    DealerAvailabilityUpdate,
    DealerRequestRead,
    DealerServiceAreaIn,
)
from app.services import dealers as dealer_service
from app.services.matching import (
    available_requests_for_dealer,
    dealer_eligible_for_request,
    payout_estimate,
)
from app.services.serializers import booking_summary, dealer_detail, request_read

router = APIRouter(
    prefix="/dealers",
    tags=["dealers"],
    dependencies=[Depends(require_roles(Role.DEALER))],
)

DOC_TYPES = {
    "gst_certificate",
    "pan_card",
    "trade_licence",
    "shop_establishment",
    "id_proof",
    "other",
}


@router.get("/dashboard")
def dashboard(db: DbSession, user: CurrentUser):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        return {
            "profile": None,
            "available_requests": 0,
            "pending_offers": 0,
            "accepted_jobs": 0,
            "todays_pickups": 0,
            "completed_jobs": 0,
            "cancellation_rate": 0,
            "rating_avg": 0,
            "rating_count": 0,
            "recorded_earnings": 0,
            "unread_notifications": 0,
        }
    loaded = dealer_service.load_dealer(db, dealer.id)
    return {"profile": dealer_detail(loaded), **dealer_service.dashboard(db, loaded)}


@router.get("/profile")
def profile(db: DbSession, user: CurrentUser):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise NotFoundError("No dealer application yet.")
    return dealer_detail(dealer_service.load_dealer(db, dealer.id))


@router.post("/applications")
def submit_application(
    payload: DealerApplication, request: Request, db: DbSession, user: CurrentUser
):
    dealer = dealer_service.apply_application(db, user, payload, http_request=request)
    return dealer_detail(dealer)


@router.put("/service-areas")
def set_service_areas(
    areas: list[DealerServiceAreaIn], request: Request, db: DbSession, user: CurrentUser
):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise ConflictError("Submit your dealer application before adding service areas.")
    updated = dealer_service.set_service_areas(
        db, dealer, areas, actor=user, http_request=request
    )
    return dealer_detail(updated)


@router.put("/categories")
def set_categories(
    payload: CategorySelection, request: Request, db: DbSession, user: CurrentUser
):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise ConflictError("Submit your dealer application before selecting categories.")
    updated = dealer_service.set_categories(
        db, dealer, payload.category_ids, actor=user, http_request=request
    )
    return dealer_detail(updated)


@router.patch("/availability")
def update_availability(
    payload: DealerAvailabilityUpdate, request: Request, db: DbSession, user: CurrentUser
):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise ConflictError("Submit your dealer application first.")
    updated = dealer_service.update_availability(
        db, dealer, payload, actor=user, http_request=request
    )
    return dealer_detail(updated)


@router.post("/documents", status_code=201)
async def upload_document(
    request: Request,
    db: DbSession,
    user: CurrentUser,
    doc_type: str = Form(...),
    file: UploadFile = File(...),
):
    if doc_type not in DOC_TYPES:
        raise ValidationError("Unsupported document type.")
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise ConflictError("Submit your dealer application before uploading documents.")
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1024)
    from app.integrations.storage import save_document

    stored = save_document(
        "dealer-docs",
        dealer.id,
        data,
        file.content_type or "application/octet-stream",
        file.filename or "document",
    )
    updated = dealer_service.add_document(
        db,
        dealer,
        actor=user,
        doc_type=doc_type,
        stored_key=stored.key,
        file_name=file.filename or "document",
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
    )
    return dealer_detail(updated)


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, db: DbSession, user: CurrentUser):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise NotFoundError("Dealer profile not found.")
    updated = dealer_service.delete_document(db, dealer, document_id, actor=user)
    return dealer_detail(updated)


@router.get("/requests", response_model=list[DealerRequestRead])
def available_requests(
    db: DbSession,
    user: CurrentUser,
    category_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    preferred_date: str | None = Query(default=None),
    time_window: str | None = Query(default=None),
    max_weight_kg: float | None = Query(default=None, gt=0),
    service_area: str | None = Query(default=None),
):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise ConflictError("Submit your dealer application to see matching requests.")
    loaded = dealer_service.load_dealer(db, dealer.id)
    if loaded.status != "approved":
        raise ForbiddenError("Dealer verification is required to receive job requests.")
    results = available_requests_for_dealer(
        db, loaded, category_id=category_id, search=search, limit=100
    )
    if preferred_date:
        results = [r for r in results if r["preferred_date"].isoformat() == preferred_date]
    if time_window:
        results = [r for r in results if r["time_window"] == time_window]
    if max_weight_kg:
        results = [
            r
            for r in results
            if r["estimated_total_weight_kg"] is None
            or float(r["estimated_total_weight_kg"]) <= max_weight_kg
        ]
    if service_area:
        needle = service_area.lower()
        results = [r for r in results if needle in (r["locality"] or "").lower()]
    return results


@router.get("/requests/{request_id}")
def request_detail(request_id: str, db: DbSession, user: CurrentUser):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        raise ConflictError("Submit your dealer application first.")
    loaded = dealer_service.load_dealer(db, dealer.id)
    if loaded.status != "approved":
        raise ForbiddenError("Dealer verification is required to view requests.")
    scrap = db.get(ScrapRequest, request_id)
    if not scrap:
        raise NotFoundError("Scrap request not found.")
    eligible, reasons = dealer_eligible_for_request(db, loaded, scrap)
    from app.services.requests import load_request

    scrap = load_request(db, request_id)
    payload = request_read(scrap)
    payload["customer_notes"] = scrap.customer_notes
    payload["eligible"] = eligible
    payload["eligibility_reasons"] = reasons
    payload["indicative_payout"] = payout_estimate(db, loaded, scrap)
    return payload


@router.get("/bookings")
def dealer_bookings(
    db: DbSession, user: CurrentUser, status: str | None = Query(default=None)
):
    dealer = dealer_service.get_or_create_dealer(db, user)
    if not dealer:
        return []
    return [
        booking_summary(b)
        for b in dealer_service.dealer_bookings(db, dealer, status=status)
    ]

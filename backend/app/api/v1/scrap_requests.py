"""Customer scrap listings and image uploads."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession, Paging, require_roles
from app.core.config import settings
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.models import (
    CustomerAddress,
    DealerOffer,
    OfferStatus,
    RequestStatus,
    Role,
    ScrapImage,
    ScrapRequest,
    ScrapRequestItem,
)
from app.schemas import (
    ImageRead,
    Page,
    RequestCreate,
    RequestRead,
    RequestUpdate,
)
from app.services import offers as offer_service
from app.services import requests as request_service
from app.services.serializers import image_read, offer_read, request_read

router = APIRouter(
    prefix="/scrap-requests",
    tags=["scrap-requests"],
    dependencies=[Depends(require_roles(Role.CUSTOMER))],
)

SORT_OPTIONS = {"payout", "pickup", "rating", "proximity"}


@router.get("", response_model=Page[RequestRead])
def list_requests(
    db: DbSession,
    user: CurrentUser,
    paging: Paging,
    status: str | None = Query(default=None),
):
    stmt = select(ScrapRequest).where(
        ScrapRequest.customer_id == user.id, ScrapRequest.deleted_at.is_(None)
    )
    if status:
        if status not in {s.value for s in RequestStatus}:
            raise ValidationError("Unknown listing status filter.")
        stmt = stmt.where(ScrapRequest.status == status)
    total = int(
        db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    )
    rows = (
        db.execute(
            request_service.request_query()
            .where(
                ScrapRequest.customer_id == user.id,
                ScrapRequest.deleted_at.is_(None),
                *([ScrapRequest.status == status] if status else []),
            )
            .order_by(ScrapRequest.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    return {
        "items": [request_read(r) for r in rows],
        "total": total,
        "page": paging.page,
        "page_size": paging.page_size,
        "pages": max(1, (total + paging.page_size - 1) // paging.page_size),
    }


@router.post("", response_model=RequestRead, status_code=201)
def create_request(payload: RequestCreate, db: DbSession, user: CurrentUser):
    request = request_service.create_request(db, user, payload)
    return request_read(request)


@router.get("/{request_id}", response_model=RequestRead)
def get_request(request_id: str, db: DbSession, user: CurrentUser):
    request = request_service.load_request(db, request_id)
    request_service.assert_customer_owns(request, user)
    return request_read(request, include_address=True)


@router.patch("/{request_id}", response_model=RequestRead)
def update_request(
    request_id: str, payload: RequestUpdate, db: DbSession, user: CurrentUser
):
    request = request_service.load_request(db, request_id)
    updated = request_service.update_request(db, request, user, payload)
    return request_read(updated, include_address=True)


@router.post("/{request_id}/submit", response_model=RequestRead)
def submit_request(request_id: str, db: DbSession, user: CurrentUser):
    request = request_service.load_request(db, request_id)
    submitted = request_service.submit_request(db, request, user)
    return request_read(submitted)


@router.post("/{request_id}/images", response_model=list[ImageRead], status_code=201)
async def upload_images(
    request_id: str,
    db: DbSession,
    user: CurrentUser,
    files: list[UploadFile] = File(...),
):
    from app.integrations.storage import process_image, save_image

    request = request_service.load_request(db, request_id)
    request_service.assert_customer_owns(request, user)
    if request.status != RequestStatus.DRAFT:
        raise ConflictError("Photos can only be changed while the listing is a draft.")
    active = [img for img in request.images if img.deleted_at is None]
    remaining = settings.max_images_per_request - len(active)
    if len(files) > remaining:
        raise ValidationError(
            f"You can add {max(remaining, 0)} more photo(s) to this listing."
        )
    saved: list[ScrapImage] = []
    try:
        for index, upload in enumerate(files):
            if upload.content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise ValidationError("Upload JPEG, PNG or WebP images only.")
            data = await upload.read(settings.max_upload_mb * 1024 * 1024 + 1024)
            stored = save_image("request-images", request.id, data)
            image = ScrapImage(
                request_id=request.id,
                uploaded_by=user.id,
                object_key=stored.key,
                mime_type=stored.mime_type,
                size_bytes=stored.size_bytes,
                width=stored.width,
                height=stored.height,
                sort_order=len(active) + index,
            )
            db.add(image)
            saved.append(image)
        request.version += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    for image in saved:
        db.refresh(image)
    return [image_read(img) for img in saved]


@router.delete("/{request_id}/images/{image_id}", response_model=dict)
def delete_image(
    request_id: str, image_id: str, db: DbSession, user: CurrentUser
):
    request = request_service.load_request(db, request_id)
    request_service.assert_customer_owns(request, user)
    if request.status != RequestStatus.DRAFT:
        raise ConflictError("Photos can only be changed while the listing is a draft.")
    image = db.get(ScrapImage, image_id)
    if not image or image.request_id != request.id or image.deleted_at is not None:
        raise NotFoundError("Photo not found.")
    image.deleted_at = image.created_at
    from app.integrations.storage import delete_object

    delete_object(image.object_key)
    db.commit()
    return {"message": "Photo removed."}


@router.get("/{request_id}/offers", response_model=list[dict])
def list_offers(
    request_id: str,
    db: DbSession,
    user: CurrentUser,
    sort: str = Query(default="payout"),
):
    from app.core.time import utcnow

    request = request_service.load_request(db, request_id)
    request_service.assert_customer_owns(request, user)
    if sort not in SORT_OPTIONS:
        raise ValidationError("Sort by payout, pickup, rating or proximity.")
    rows = offer_service.offers_for_request(db, request.id)
    rows = [o for o in rows if o.status in (OfferStatus.SUBMITTED, OfferStatus.ACCEPTED)]
    payload = [offer_read(o, now=utcnow()) for o in rows]
    window_order = {"morning": 0, "midday": 1, "afternoon": 2, "evening": 3}
    if sort == "payout":
        payload.sort(
            key=lambda o: (-Decimal(o["estimated_payout"]), o["pickup_date"])
        )
    elif sort == "pickup":
        payload.sort(
            key=lambda o: (o["pickup_date"], window_order.get(o["pickup_window"], 9))
        )
    elif sort == "rating":
        payload.sort(
            key=lambda o: (-o["dealer"]["rating_avg"], -o["dealer"]["rating_count"])
        )
    else:
        payload.sort(
            key=lambda o: (
                0
                if (o["dealer"]["locality"] or "").lower() == request.locality.lower()
                else 1,
                -Decimal(o["estimated_payout"]),
            )
        )
    return payload

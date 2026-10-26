"""Administrator API: metrics, moderation, disputes, catalog, audit, exports."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession, Paging, require_roles
from app.api.v1._common import serialize_booking
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import mask_phone
from app.models import (
    AuditLog,
    Booking,
    City,
    DealerOffer,
    DealerOfferItem,
    DealerProfile,
    Dispute,
    MaterialCategory,
    MaterialPriceReference,
    OfferStatus,
    PaymentRecord,
    PaymentStatus,
    PlatformFeeRule,
    RequestStatus,
    Review,
    Role,
    ScrapRequest,
    Settlement,
    SupportTicket,
    User,
    UserProfile,
    UserStatus,
)
from app.schemas import (
    AdminDealerAction,
    AdminReviewAction,
    AdminUserAction,
    AuditLogRead,
    CategoryCreate,
    CategoryUpdate,
    CityCreate,
    CityUpdate,
    FeeRuleCreate,
    FeeRuleRead,
    Page,
    PriceReferenceCreate,
    PriceReferenceRead,
    ResolveDisputeBody,
    SupportTicketUpdate,
    UserReportResolve,
)
from app.services import admin as admin_service
from app.services import audit
from app.services import bookings as booking_service
from app.services.serializers import (
    booking_summary,
    decimal_str,
    dealer_detail,
    offer_read,
    payment_read,
    settlement_read,
)

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(Role.ADMIN))],
)


def _page(items, total: int, paging) -> dict:
    return {
        "items": items,
        "total": total,
        "page": paging.page,
        "page_size": paging.page_size,
        "pages": max(1, (total + paging.page_size - 1) // paging.page_size),
    }


@router.get("/dashboard")
def dashboard(db: DbSession, admin: CurrentUser):
    return admin_service.dashboard(db)


@router.get("/dealers")
def dealers(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
):
    total, rows = admin_service.dealer_rows(
        db, status=status, search=search, page=paging.page, page_size=paging.page_size
    )
    items = []
    for dealer in rows:
        items.append(
            {
                "id": dealer.id,
                "user_id": dealer.user_id,
                "phone_masked": mask_phone(dealer.user.phone) if dealer.user else None,
                "business_name": dealer.business_name,
                "contact_person": dealer.contact_person,
                "city_name": dealer.city.name if dealer.city else None,
                "locality": dealer.locality,
                "status": dealer.status,
                "verification_notes": dealer.verification_notes,
                "rejection_reason": dealer.rejection_reason,
                "rating_avg": decimal_str(dealer.rating_avg),
                "rating_count": dealer.rating_count,
                "completed_jobs": dealer.completed_jobs,
                "document_count": len(dealer.documents),
                "created_at": dealer.created_at,
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
                        "url": f"/api/v1/files/{doc.file_key}",
                    }
                    for doc in dealer.documents
                ],
            }
        )
    return _page(items, total, paging)


@router.get("/dealers/{dealer_id}")
def dealer_detail_admin(dealer_id: str, db: DbSession, admin: CurrentUser):
    from app.services.dealers import load_dealer

    dealer = load_dealer(db, dealer_id)
    data = dealer_detail(dealer)
    data["user_id"] = dealer.user_id
    data["phone_masked"] = mask_phone(dealer.user.phone) if dealer.user else None
    keys = {doc.id: doc.file_key for doc in dealer.documents}
    data["documents"] = [
        {**doc, "url": f"/api/v1/files/{keys.get(doc['id'], '')}"}
        for doc in data["documents"]
    ]
    return data


@router.post("/dealers/{dealer_id}/approve")
def approve_dealer(
    dealer_id: str,
    payload: AdminDealerAction,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    from app.services.dealers import load_dealer

    dealer = load_dealer(db, dealer_id)
    admin_service.approve_dealer(
        db, dealer, admin, reason=payload.reason, http_request=request
    )
    return {"message": f"{dealer.business_name} approved."}


@router.post("/dealers/{dealer_id}/reject")
def reject_dealer(
    dealer_id: str,
    payload: AdminDealerAction,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    from app.services.dealers import load_dealer

    dealer = load_dealer(db, dealer_id)
    admin_service.reject_dealer(
        db, dealer, admin, reason=payload.reason, http_request=request
    )
    return {"message": "Dealer application rejected."}


@router.post("/dealers/{dealer_id}/suspend")
def suspend_dealer(
    dealer_id: str,
    payload: AdminDealerAction,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    from app.services.dealers import load_dealer

    dealer = load_dealer(db, dealer_id)
    admin_service.suspend_dealer(
        db, dealer, admin, reason=payload.reason, http_request=request
    )
    return {"message": "Dealer suspended."}


@router.post("/dealers/{dealer_id}/reactivate")
def reactivate_dealer(
    dealer_id: str,
    payload: AdminDealerAction,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    from app.services.dealers import load_dealer

    dealer = load_dealer(db, dealer_id)
    admin_service.reactivate_dealer(
        db, dealer, admin, reason=payload.reason, http_request=request
    )
    return {"message": "Dealer reactivated."}


@router.get("/users")
def users(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
):
    stmt = select(User)
    if role:
        stmt = stmt.where(User.role == role)
    if status:
        stmt = stmt.where(User.status == status)
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.join(UserProfile, UserProfile.user_id == User.id, isouter=True).where(
            or_(
                func.lower(User.phone).like(like),
                func.lower(UserProfile.full_name).like(like),
            )
        )
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(User.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    dealer_map = {}
    dealer_rows = db.execute(
        select(DealerProfile.user_id, DealerProfile.status).where(
            DealerProfile.user_id.in_([u.id for u in rows])
        )
    ).all()
    dealer_map = {uid: status for uid, status in dealer_rows}
    items = [
        {
            "id": u.id,
            "phone_masked": mask_phone(u.phone),
            "name": u.profile.full_name if u.profile else None,
            "role": u.role,
            "status": u.status,
            "created_at": u.created_at,
            "last_login_at": u.last_login_at,
            "dealer_status": dealer_map.get(u.id),
        }
        for u in rows
    ]
    return _page(items, total, paging)


@router.post("/users/{user_id}/{action}")
def user_status(
    user_id: str,
    action: str,
    payload: AdminUserAction,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    if action not in ("suspend", "reinstate"):
        raise ValidationError("Unsupported user action.")
    target = db.get(User, user_id)
    if not target:
        raise NotFoundError("User not found.")
    admin_service.set_user_status(
        db, target, admin, action=action, reason=payload.reason, http_request=request
    )
    return {"message": f"User {action}d."}


@router.get("/bookings")
def bookings(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
    city_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
):
    stmt = (
        select(Booking)
        .options(
            selectinload(Booking.dealer),
            selectinload(Booking.request).selectinload(ScrapRequest.city),
            selectinload(Booking.settlements),
        )
        .join(ScrapRequest, ScrapRequest.id == Booking.request_id)
    )
    if status:
        stmt = stmt.where(Booking.status == status)
    if city_id:
        stmt = stmt.where(ScrapRequest.city_id == city_id)
    if search:
        stmt = stmt.where(Booking.reference.ilike(f"%{search}%"))
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(Booking.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    items = []
    for booking in rows:
        summary = booking_summary(booking)
        summary["customer_name"] = (
            booking.customer.profile.full_name if booking.customer and booking.customer.profile else None
        )
        summary["payment_status"] = (
            booking.payments[-1].status if booking.payments else None
        )
        items.append(summary)
    return _page(items, total, paging)


@router.get("/bookings/{booking_id}")
def booking_detail(booking_id: str, db: DbSession, admin: CurrentUser):
    booking = booking_service.load_booking(db, booking_id)
    data = serialize_booking(db, booking, "admin")
    return data


@router.get("/requests")
def requests_monitor(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
    city_id: str | None = Query(default=None),
):
    stmt = (
        select(ScrapRequest)
        .options(
            selectinload(ScrapRequest.customer).selectinload(User.profile),
            selectinload(ScrapRequest.city),
            selectinload(ScrapRequest.items),
        )
    )
    if status:
        stmt = stmt.where(ScrapRequest.status == status)
    if city_id:
        stmt = stmt.where(ScrapRequest.city_id == city_id)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(ScrapRequest.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    items = [
        {
            "id": r.id,
            "reference": r.reference,
            "status": r.status,
            "locality": r.locality,
            "city_name": r.city.name if r.city else None,
            "customer_phone_masked": mask_phone(r.customer.phone) if r.customer else None,
            "customer_name": r.customer.profile.full_name if r.customer and r.customer.profile else None,
            "preferred_date": r.preferred_date,
            "time_window": r.time_window,
            "materials": len(r.items),
            "offer_count": r.offer_count,
            "created_at": r.created_at,
        }
        for r in rows
    ]
    return _page(items, total, paging)


@router.get("/requests/{request_id}/matching")
def request_matching(request_id: str, db: DbSession, admin: CurrentUser):
    from app.services.matching import suggest_dealers_for_request
    from app.services.requests import load_request

    scrap = load_request(db, request_id)
    return suggest_dealers_for_request(db, scrap)


@router.get("/offers")
def offers_monitor(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
    request_id: str | None = Query(default=None),
):
    stmt = (
        select(DealerOffer)
        .options(
            selectinload(DealerOffer.items).selectinload(DealerOfferItem.category),
            selectinload(DealerOffer.dealer),
            selectinload(DealerOffer.request),
        )
    )
    if status:
        stmt = stmt.where(DealerOffer.status == status)
    if request_id:
        stmt = stmt.where(DealerOffer.request_id == request_id)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(DealerOffer.created_at.desc())
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
    return _page(items, total, paging)


@router.get("/disputes")
def disputes(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
):
    stmt = select(Dispute).options(
        selectinload(Dispute.booking).selectinload(Booking.customer),
        selectinload(Dispute.booking).selectinload(Booking.dealer),
        selectinload(Dispute.booking).selectinload(Booking.request),
        selectinload(Dispute.evidence),
    )
    if status:
        stmt = stmt.where(Dispute.status == status)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(Dispute.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    items = [
        {
            "id": d.id,
            "booking_id": d.booking_id,
            "booking_reference": d.booking.reference if d.booking else None,
            "category": d.category,
            "description": d.description,
            "status": d.status,
            "raised_by_role": d.raised_by_role,
            "created_at": d.created_at,
            "resolved_at": d.resolved_at,
            "resolution": d.resolution,
            "evidence_count": len(d.evidence),
            "final_payout": (
                d.booking.settlements[-1].final_payout
                if d.booking and d.booking.settlements
                else None
            ),
        }
        for d in rows
    ]
    return _page(items, total, paging)


@router.post("/disputes/{dispute_id}/resolve")
def resolve_dispute(
    dispute_id: str,
    payload: ResolveDisputeBody,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    dispute = db.get(Dispute, dispute_id)
    if not dispute:
        raise NotFoundError("Dispute not found.")
    updated = admin_service.resolve_dispute(
        db, dispute, admin, payload, http_request=request
    )
    return {
        "message": "Dispute resolved.",
        "dispute_id": updated.id,
        "status": updated.status,
        "resolution": updated.resolution,
    }


@router.get("/payments")
def payments(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
):
    stmt = select(PaymentRecord).options(selectinload(PaymentRecord.booking))
    if status:
        stmt = stmt.where(PaymentRecord.status == status)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(PaymentRecord.recorded_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    items = []
    for payment in rows:
        data = payment_read(payment)
        data["booking_reference"] = payment.booking.reference if payment.booking else None
        data["gateway_verified"] = False
        items.append(data)
    return _page(items, total, paging)


@router.post("/payments/{payment_id}/verify")
def verify_payment(
    payment_id: str,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    note: str = Query(min_length=3),
):
    payment = db.get(PaymentRecord, payment_id)
    if not payment:
        raise NotFoundError("Payment not found.")
    admin_service.verify_payment(db, payment, admin, note=note, http_request=request)
    return {"message": "Payment reconciled as confirmed (external transfer, not gateway-verified)."}


@router.get("/reviews")
def reviews(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
):
    stmt = select(Review).options(selectinload(Review.booking))
    if status:
        stmt = stmt.where(Review.status == status)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(Review.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    items = []
    for review in rows:
        dealer = db.get(DealerProfile, review.dealer_id)
        items.append(
            {
                "id": review.id,
                "booking_id": review.booking_id,
                "booking_reference": review.booking.reference if review.booking else None,
                "rating": review.rating,
                "comment": review.comment,
                "status": review.status,
                "created_at": review.created_at,
                "dealer_name": dealer.business_name if dealer else None,
                "admin_note": review.admin_note,
            }
        )
    return _page(items, total, paging)


@router.post("/reviews/{review_id}/moderate")
def moderate_review(
    review_id: str,
    payload: AdminReviewAction,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    review = db.get(Review, review_id)
    if not review:
        raise NotFoundError("Review not found.")
    admin_service.moderate_review(
        db, review, admin, action=payload.action, note=payload.note, http_request=request
    )
    return {"message": f"Review {payload.action}ed."}


@router.get("/support")
def support_tickets(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
):
    total, rows = admin_service.open_support_rows(
        db, status=status, page=paging.page, page_size=paging.page_size
    )
    items = []
    for ticket in rows:
        user_row = db.get(User, ticket.user_id)
        items.append(
            {
                "id": ticket.id,
                "reference": ticket.reference,
                "user_id": ticket.user_id,
                "user_phone_masked": mask_phone(user_row.phone) if user_row else None,
                "subject": ticket.subject,
                "message": ticket.message,
                "category": ticket.category,
                "status": ticket.status,
                "priority": ticket.priority,
                "resolution": ticket.resolution,
                "created_at": ticket.created_at,
            }
        )
    return _page(items, total, paging)


@router.patch("/support/{ticket_id}")
def update_support(
    ticket_id: str,
    payload: SupportTicketUpdate,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise NotFoundError("Support ticket not found.")
    before = ticket.status
    ticket.status = payload.status
    if payload.resolution is not None:
        ticket.resolution = payload.resolution
    ticket.assigned_to = admin.id
    audit.record(
        db, actor=admin, action="support.ticket_updated", entity_type="support_ticket",
        entity_id=ticket.id, before={"status": before}, after={"status": ticket.status},
        reason=payload.resolution, request=request,
    )
    db.commit()
    return {"message": "Support ticket updated."}


@router.get("/reports")
def reports(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    status: str | None = Query(default=None),
):
    from app.models import UserReport

    stmt = select(UserReport)
    if status:
        stmt = stmt.where(UserReport.status == status)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(UserReport.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    items = []
    for report in rows:
        reporter = db.get(User, report.reporter_id)
        reported = db.get(User, report.reported_user_id)
        items.append(
            {
                "id": report.id,
                "reason": report.reason,
                "details": report.details,
                "status": report.status,
                "resolution": report.resolution,
                "created_at": report.created_at,
                "reporter_phone_masked": mask_phone(reporter.phone) if reporter else None,
                "reported_phone_masked": mask_phone(reported.phone) if reported else None,
            }
        )
    return _page(items, total, paging)


@router.patch("/reports/{report_id}")
def resolve_report(
    report_id: str,
    body: UserReportResolve,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    from app.models import UserReport

    report = db.get(UserReport, report_id)
    if not report:
        raise NotFoundError("Report not found.")
    report.status = body.status
    report.resolution = body.resolution
    report.resolved_by = admin.id
    audit.record(
        db, actor=admin, action="user_report.resolved", entity_type="user_report",
        entity_id=report.id, after={"status": body.status, "resolution": body.resolution},
        request=request,
    )
    db.commit()
    return {"message": "Report updated."}


@router.get("/audit-logs", response_model=Page[AuditLogRead])
def audit_logs(
    db: DbSession,
    paging: Paging,
    admin: CurrentUser,
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    actor_id: str | None = Query(default=None),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
):
    total, rows = admin_service.list_audit_logs(
        db,
        action=action,
        entity_type=entity_type,
        actor_id=actor_id,
        since=since,
        until=until,
        page=paging.page,
        page_size=paging.page_size,
    )
    return {
        "items": rows,
        "total": total,
        "page": paging.page,
        "page_size": paging.page_size,
        "pages": max(1, (total + paging.page_size - 1) // paging.page_size),
    }


@router.get("/exports/{kind}")
def export_csv(
    kind: str,
    db: DbSession,
    admin: CurrentUser,
    request: Request = None,  # type: ignore[assignment]
):
    if kind not in {"bookings", "dealers", "disputes", "audit-logs"}:
        raise ValidationError("Export type must be bookings, dealers, disputes or audit-logs.")
    content, filename = admin_service.export_rows(db, kind)
    audit.record(
        db, actor=admin, action="export.generated", entity_type="export",
        entity_id=kind, reason=f"CSV export of {kind}", request=request,
    )
    db.commit()
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- catalogue management ---------------------------------------------------


@router.get("/material-categories")
def all_categories(db: DbSession, admin: CurrentUser):
    rows = db.execute(
        select(MaterialCategory).order_by(MaterialCategory.sort_order, MaterialCategory.name)
    ).scalars().all()
    return [
        {
            "id": c.id,
            "slug": c.slug,
            "name": c.name,
            "description": c.description,
            "unit": c.unit,
            "icon": c.icon,
            "is_active": c.is_active,
            "requires_special_handling": c.requires_special_handling,
            "sort_order": c.sort_order,
        }
        for c in rows
    ]


@router.post("/material-categories", status_code=201)
def create_category(
    payload: CategoryCreate, request: Request, db: DbSession, admin: CurrentUser
):
    exists = db.execute(
        select(MaterialCategory).where(MaterialCategory.slug == payload.slug)
    ).scalar_one_or_none()
    if exists:
        raise ConflictError("A category with this slug already exists.")
    category = MaterialCategory(**payload.model_dump())
    db.add(category)
    audit.record(
        db, actor=admin, action="category.created", entity_type="material_category",
        entity_id=category.id, after=payload.model_dump(), request=request,
    )
    db.commit()
    return {"id": category.id, "message": "Category created."}


@router.patch("/material-categories/{category_id}")
def update_category(
    category_id: str,
    payload: CategoryUpdate,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    category = db.get(MaterialCategory, category_id)
    if not category:
        raise NotFoundError("Category not found.")
    before = {
        "name": category.name,
        "is_active": category.is_active,
        "unit": category.unit,
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    audit.record(
        db, actor=admin, action="category.updated", entity_type="material_category",
        entity_id=category.id, before=before,
        after=payload.model_dump(exclude_unset=True), request=request,
    )
    db.commit()
    return {"message": "Category updated."}


@router.delete("/material-categories/{category_id}")
def deactivate_category(
    category_id: str, request: Request, db: DbSession, admin: CurrentUser
):
    category = db.get(MaterialCategory, category_id)
    if not category:
        raise NotFoundError("Category not found.")
    if not category.is_active:
        raise ConflictError("Category is already inactive.")
    category.is_active = False
    audit.record(
        db, actor=admin, action="category.deactivated", entity_type="material_category",
        entity_id=category.id, after={"is_active": False}, request=request,
    )
    db.commit()
    return {"message": "Category deactivated. Historical records are preserved."}


@router.get("/price-references", response_model=list[PriceReferenceRead])
def price_references(
    db: DbSession,
    admin: CurrentUser,
    category_id: str | None = Query(default=None),
    city_id: str | None = Query(default=None),
):
    stmt = select(MaterialPriceReference).options(
        selectinload(MaterialPriceReference.category)
    )
    if category_id:
        stmt = stmt.where(MaterialPriceReference.category_id == category_id)
    if city_id:
        stmt = stmt.where(MaterialPriceReference.city_id == city_id)
    rows = db.execute(stmt.order_by(MaterialPriceReference.effective_from.desc())).scalars().all()
    return [
        {
            "id": row.id,
            "category_id": row.category_id,
            "category_name": row.category.name if row.category else None,
            "city_id": row.city_id,
            "indicative_min_rate": row.indicative_min_rate,
            "indicative_max_rate": row.indicative_max_rate,
            "effective_from": row.effective_from,
            "effective_to": row.effective_to,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/price-references", status_code=201)
def create_price_reference(
    payload: PriceReferenceCreate,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    if not db.get(MaterialCategory, payload.category_id):
        raise NotFoundError("Category not found.")
    if payload.city_id and not db.get(City, payload.city_id):
        raise NotFoundError("City not found.")
    row = MaterialPriceReference(**payload.model_dump(), created_by=admin.id)
    db.add(row)
    audit.record(
        db, actor=admin, action="price_reference.created", entity_type="price_reference",
        entity_id=row.id, after=payload.model_dump(mode="json"), request=request,
    )
    db.commit()
    return {"id": row.id, "message": "Indicative price added."}


@router.delete("/price-references/{reference_id}")
def delete_price_reference(
    reference_id: str, request: Request, db: DbSession, admin: CurrentUser
):
    row = db.get(MaterialPriceReference, reference_id)
    if not row:
        raise NotFoundError("Price reference not found.")
    before = {
        "category_id": row.category_id,
        "min": str(row.indicative_min_rate),
        "max": str(row.indicative_max_rate),
        "effective_from": row.effective_from.isoformat(),
    }
    db.delete(row)
    audit.record(
        db, actor=admin, action="price_reference.deleted", entity_type="price_reference",
        entity_id=reference_id, before=before, request=request,
    )
    db.commit()
    return {"message": "Price reference removed."}


@router.get("/fee-rules", response_model=list[FeeRuleRead])
def fee_rules(db: DbSession, admin: CurrentUser):
    rows = db.execute(select(PlatformFeeRule).order_by(PlatformFeeRule.created_at.desc())).scalars().all()
    return rows


@router.post("/fee-rules", response_model=FeeRuleRead, status_code=201)
def create_fee_rule(
    payload: FeeRuleCreate, request: Request, db: DbSession, admin: CurrentUser
):
    if payload.fee_type == "percent" and payload.value > 100:
        raise ValidationError("A percentage fee cannot exceed 100%.")
    row = PlatformFeeRule(**payload.model_dump(), created_by=admin.id)
    db.add(row)
    audit.record(
        db, actor=admin, action="fee_rule.created", entity_type="platform_fee_rule",
        entity_id=row.id, after=payload.model_dump(mode="json"), request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.post("/fee-rules/{rule_id}/deactivate")
def deactivate_fee_rule(
    rule_id: str, request: Request, db: DbSession, admin: CurrentUser
):
    row = db.get(PlatformFeeRule, rule_id)
    if not row:
        raise NotFoundError("Fee rule not found.")
    if not row.is_active:
        raise ConflictError("Fee rule is already inactive.")
    row.is_active = False
    audit.record(
        db, actor=admin, action="fee_rule.deactivated", entity_type="platform_fee_rule",
        entity_id=row.id, after={"is_active": False}, request=request,
    )
    db.commit()
    return {"message": "Fee rule deactivated. Existing settlements are unchanged."}


# --- cities -----------------------------------------------------------------


@router.get("/cities")
def all_cities(db: DbSession, admin: CurrentUser):
    rows = db.execute(select(City).order_by(City.name)).scalars().all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "state": c.state,
            "slug": c.slug,
            "timezone": c.timezone,
            "is_active": c.is_active,
        }
        for c in rows
    ]


@router.post("/cities", status_code=201)
def create_city(
    payload: CityCreate, request: Request, db: DbSession, admin: CurrentUser
):
    exists = db.execute(select(City).where(City.slug == payload.slug)).scalar_one_or_none()
    if exists:
        raise ConflictError("A city with this slug already exists.")
    city = City(**payload.model_dump())
    db.add(city)
    audit.record(
        db, actor=admin, action="city.created", entity_type="city",
        entity_id=city.id, after=payload.model_dump(), request=request,
    )
    db.commit()
    return {"id": city.id, "message": "City added."}


@router.patch("/cities/{city_id}")
def update_city(
    city_id: str,
    payload: CityUpdate,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
):
    city = db.get(City, city_id)
    if not city:
        raise NotFoundError("City not found.")
    before = {"name": city.name, "is_active": city.is_active}
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(city, key, value)
    audit.record(
        db, actor=admin, action="city.updated", entity_type="city", entity_id=city.id,
        before=before, after=payload.model_dump(exclude_unset=True), request=request,
    )
    db.commit()
    return {"message": "City updated."}

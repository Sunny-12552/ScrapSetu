"""In-app notifications."""

from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, Paging
from app.core.errors import NotFoundError
from app.models import Notification
from app.services import notifications as notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _payload(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "data": n.data or {},
        "is_read": n.is_read,
        "created_at": n.created_at,
    }


@router.get("")
def list_notifications(
    db: DbSession,
    user: CurrentUser,
    paging: Paging,
    unread_only: bool = Query(default=False),
):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(Notification.created_at.desc())
            .offset(paging.offset)
            .limit(paging.page_size)
        )
        .scalars()
        .all()
    )
    return {
        "items": [_payload(n) for n in rows],
        "unread": notification_service.unread_count(db, user.id),
        "total": total,
        "page": paging.page,
        "page_size": paging.page_size,
    }


@router.post("/read-all")
def read_all(db: DbSession, user: CurrentUser):
    count = notification_service.mark_read(db, user.id)
    return {"message": f"{count} notification(s) marked as read."}


@router.post("/{notification_id}/read")
def read_one(notification_id: str, db: DbSession, user: CurrentUser):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise NotFoundError("Notification not found.")
    count = notification_service.mark_read(db, user.id, notification_id)
    return {"message": "Notification marked as read.", "updated": count}

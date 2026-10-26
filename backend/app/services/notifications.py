"""Persisted notifications with optional SMS/email fan-out.

Delivery failures are isolated from business transactions and retried by the
worker — a failed SMS must never roll back a booking or payment.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.integrations import email as email_integration
from app.integrations import sms as sms_integration
from app.models import (
    Notification,
    NotificationChannel,
    NotificationDelivery,
    User,
    UserProfile,
)

logger = logging.getLogger("scrapsetu.notifications")

SMS_TYPES = {
    "offer_received",
    "offer_accepted",
    "pickup_scheduled",
    "pickup_started",
    "settlement_submitted",
    "payment_confirmed",
    "booking_completed",
    "booking_cancelled",
    "dispute_updated",
    "dealer_approved",
    "dealer_rejected",
    "dealer_suspended",
}


def notify(
    db: Session,
    *,
    user_id: str,
    type: str,
    title: str,
    body: str,
    data: dict | None = None,
    dedupe_key: str | None = None,
    send_sms: bool | None = None,
    send_email: bool = False,
) -> Notification | None:
    if dedupe_key:
        existing = db.execute(
            select(Notification).where(Notification.dedupe_key == dedupe_key)
        ).scalar_one_or_none()
        if existing:
            return existing
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title[:200],
        body=body[:2000],
        data=data or {},
        dedupe_key=dedupe_key,
    )
    db.add(notification)
    db.flush()

    if send_sms is None:
        send_sms = type in SMS_TYPES
    if send_sms:
        db.add(
            NotificationDelivery(
                notification_id=notification.id, channel=NotificationChannel.SMS
            )
        )
    if send_email:
        db.add(
            NotificationDelivery(
                notification_id=notification.id, channel=NotificationChannel.EMAIL
            )
        )
    return notification


def unread_count(db: Session, user_id: str) -> int:
    return int(
        db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id, Notification.is_read.is_(False)
            )
        ).scalar_one()
    )


def mark_read(db: Session, user_id: str, notification_id: str | None = None) -> int:
    stmt = select(Notification).where(
        Notification.user_id == user_id, Notification.is_read.is_(False)
    )
    if notification_id:
        stmt = stmt.where(Notification.id == notification_id)
    rows = db.execute(stmt).scalars().all()
    now = utcnow()
    for row in rows:
        row.is_read = True
        row.read_at = now
    db.commit()
    return len(rows)


def dispatch_pending(db: Session, limit: int = 25) -> int:
    """Attempt pending deliveries. Called by the scheduler and after commits."""
    pending = (
        db.execute(
            select(NotificationDelivery)
            .where(
                NotificationDelivery.status.in_(["pending", "failed"]),
                NotificationDelivery.attempts < 3,
            )
            .order_by(NotificationDelivery.created_at)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    sent = 0
    for delivery in pending:
        notification = db.get(Notification, delivery.notification_id)
        if not notification:
            delivery.status = "skipped"
            continue
        user = db.get(User, notification.user_id)
        if not user or user.deleted_at is not None:
            delivery.status = "skipped"
            continue
        delivery.attempts += 1
        try:
            if delivery.channel == NotificationChannel.SMS:
                sms_integration.send_sms(user.phone, f"{notification.title}. {notification.body}")
            elif delivery.channel == NotificationChannel.EMAIL:
                profile = db.get(UserProfile, user.id)
                if not profile or not profile.email:
                    delivery.status = "skipped"
                    continue
                email_integration.send_email(
                    profile.email, notification.title, notification.body
                )
            delivery.status = "sent"
            delivery.sent_at = utcnow()
            delivery.last_error = None
            sent += 1
        except Exception as exc:  # noqa: BLE001 - isolate provider errors
            delivery.status = "failed"
            delivery.last_error = str(exc)[:1000]
            logger.warning("notification delivery failed: %s", exc)
    db.commit()
    return sent

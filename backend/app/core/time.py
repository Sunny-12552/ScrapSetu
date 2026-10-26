"""Time helpers. Timestamps are stored as UTC and displayed in Asia/Kolkata."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.core.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def local_tz() -> ZoneInfo:
    return ZoneInfo(settings.timezone)


def to_local(value: datetime | None) -> datetime | None:
    aware = as_utc(value)
    return aware.astimezone(local_tz()) if aware else None


def isoformat_utc(value: datetime | None) -> str | None:
    aware = as_utc(value)
    return aware.isoformat().replace("+00:00", "Z") if aware else None

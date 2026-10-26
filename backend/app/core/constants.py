"""Domain constants shared by services and schemas."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings

TIME_WINDOWS: dict[str, tuple[int, int]] = {
    "morning": (8, 11),
    "midday": (11, 14),
    "afternoon": (14, 17),
    "evening": (17, 20),
}

TIME_WINDOW_LABELS: dict[str, str] = {
    "morning": "Morning (8:00 AM - 11:00 AM)",
    "midday": "Midday (11:00 AM - 2:00 PM)",
    "afternoon": "Afternoon (2:00 PM - 5:00 PM)",
    "evening": "Evening (5:00 PM - 8:00 PM)",
}

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

DEFAULT_OPERATING_HOURS: dict[str, dict] = {
    day: {"open": "08:00", "close": "20:00", "closed": day == "sun"}
    for day in DAY_KEYS
}

MAX_ADDRESSES = 8
MAX_IMAGES = 8
MAX_LISTING_DAYS_AHEAD = 45
MIN_OFFER_VALIDITY_MINUTES = 30
MAX_OFFER_VALIDITY_HOURS = 72
MAX_QUANTITY_KG = 20000
MIN_QUANTITY_KG = 0.1
MAX_RATE_PER_KG = 100000

SETTLEMENT_ROUNDING = "ROUND_HALF_UP"
CANCELLATION_CUTOFF_HOURS = 4


def local_today() -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


def local_now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


def window_bounds_utc(day: date, window: str) -> tuple[datetime, datetime]:
    """Convert a local pickup window into UTC bounds."""
    start_hour, end_hour = TIME_WINDOWS[window]
    tz = ZoneInfo(settings.timezone)
    start = datetime.combine(day, time(start_hour), tzinfo=tz)
    end = datetime.combine(day, time(end_hour), tzinfo=tz)
    return start.astimezone(ZoneInfo("UTC")), end.astimezone(ZoneInfo("UTC"))


def next_days(count: int) -> list[date]:
    today = local_today()
    return [today + timedelta(days=i) for i in range(1, count + 1)]

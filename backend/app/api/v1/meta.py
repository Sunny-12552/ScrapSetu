"""Public metadata: categories, cities, indicative prices, integration status."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.config import settings
from app.core.constants import TIME_WINDOW_LABELS
from app.integrations import email as email_integration
from app.integrations import maps as maps_integration
from app.integrations import payments as payments_integration
from app.integrations import sms as sms_integration
from app.integrations.storage import storage_status
from app.models import City, MaterialCategory, MaterialPriceReference

router = APIRouter(prefix="/meta", tags=["meta"])


def _active_price(db, category_id: str, city_id: str | None, on: date):
    stmt = select(MaterialPriceReference).where(
        MaterialPriceReference.category_id == category_id,
        MaterialPriceReference.effective_from <= on,
    )
    rows = db.execute(stmt).scalars().all()
    usable = [
        row
        for row in rows
        if (row.effective_to is None or row.effective_to >= on)
        and (row.city_id is None or row.city_id == city_id)
    ]
    if not usable:
        return None
    usable.sort(key=lambda r: (r.city_id is not None, r.effective_from), reverse=True)
    return usable[0]


@router.get("/categories")
def categories(db: DbSession, city_id: str | None = Query(default=None)):
    query = select(MaterialCategory).where(MaterialCategory.is_active.is_(True))
    rows = db.execute(query.order_by(MaterialCategory.sort_order, MaterialCategory.name)).scalars().all()
    result = []
    for category in rows:
        price = _active_price(db, category.id, city_id, date.today())
        result.append(
            {
                "id": category.id,
                "slug": category.slug,
                "name": category.name,
                "description": category.description,
                "unit": category.unit,
                "icon": category.icon,
                "is_active": category.is_active,
                "requires_special_handling": category.requires_special_handling,
                "sort_order": category.sort_order,
                "indicative_min_rate": price.indicative_min_rate if price else None,
                "indicative_max_rate": price.indicative_max_rate if price else None,
            }
        )
    return result


@router.get("/cities")
def cities(db: DbSession):
    rows = db.execute(
        select(City).where(City.is_active.is_(True)).order_by(City.name)
    ).scalars().all()
    return [
        {"id": c.id, "name": c.name, "state": c.state, "slug": c.slug, "is_active": c.is_active}
        for c in rows
    ]


@router.get("/config")
def config(db: DbSession):
    default_city = db.execute(
        select(City).where(City.slug == settings.default_city_slug)
    ).scalar_one_or_none()
    dev_otp = settings.otp_dev_mode and not settings.is_production
    return {
        "app_name": settings.app_name,
        "tagline": "Turn your scrap into its real value.",
        "environment": settings.environment,
        "currency": "INR",
        "currency_symbol": "₹",
        "timezone": settings.timezone,
        "default_city": (
            {"id": default_city.id, "name": default_city.name, "slug": default_city.slug}
            if default_city
            else None
        ),
        "time_windows": TIME_WINDOW_LABELS,
        "otp": {
            "dev_mode": dev_otp,
            "ttl_minutes": settings.otp_ttl_minutes,
            "resend_seconds": settings.otp_resend_seconds,
            "provider": settings.sms_provider,
        },
        "integrations": {
            "sms": sms_integration.provider_status(),
            "email": email_integration.provider_status(),
            "storage": storage_status(),
            "maps": maps_integration.provider_status(),
            "payments": payments_integration.provider_status(),
        },
        "uploads": {
            "max_mb": settings.max_upload_mb,
            "max_images_per_request": settings.max_images_per_request,
            "allowed_image_types": ["image/jpeg", "image/png", "image/webp"],
        },
        "support": {
            "email": "support@scrapsetu.in",
            "hours": "Mon-Sat, 9:00 AM - 7:00 PM IST",
        },
        "legal": {
            "version": "2026-01",
            "jurisdiction": "India",
            "note": "Policies are operational drafts pending legal review.",
        },
    }

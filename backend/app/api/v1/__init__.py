"""API v1 router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    auth,
    bookings,
    customers,
    dealer_offers,
    dealers,
    dealers_public,
    files,
    meta,
    notifications,
    offers,
    reviews,
    scrap_requests,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(meta.router)
api_router.include_router(customers.router)
api_router.include_router(scrap_requests.router)
api_router.include_router(dealer_offers.router)
api_router.include_router(offers.router)
api_router.include_router(dealers.router)
api_router.include_router(dealers_public.router)
api_router.include_router(bookings.router)
api_router.include_router(notifications.router)
api_router.include_router(reviews.router)
api_router.include_router(admin.router)
api_router.include_router(files.router)

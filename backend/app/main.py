"""ScrapSetu FastAPI application."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import BACKEND_DIR, REPO_ROOT, settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, request_context_middleware
from app.core.rate_limit import client_ip, limiter
from app.db.session import engine
from app.integrations import email as email_integration
from app.integrations import maps as maps_integration
from app.integrations import payments as payments_integration
from app.integrations import sms as sms_integration
from app.integrations.storage import storage_status
from app.workers.scheduler import Scheduler

configure_logging(settings.log_level)
logger = logging.getLogger("scrapsetu")

scheduler: Scheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler
    logger.info(
        "starting %s environment=%s database=%s",
        settings.app_name,
        settings.environment,
        "sqlite" if settings.is_sqlite else "postgresql",
    )
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        logger.exception("database is not reachable at startup")
    if settings.is_production and settings.secret_key.startswith("dev-only"):
        logger.error("PRODUCTION SECRET_KEY is still the development default. Refusing is recommended.")
    if settings.enable_scheduler and not settings.is_test:
        scheduler = Scheduler()
        scheduler.start()
    yield
    if scheduler:
        scheduler.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="ScrapSetu API",
        version="1.0.0",
        description=(
            "Scrap marketplace API for India. All money values are INR decimals "
            "serialized as strings; all timestamps are UTC ISO-8601 and should be "
            "displayed in Asia/Kolkata."
        ),
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await request_context_middleware(request, call_next)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(self), camera=(), microphone=()"
        )
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        if request.url.path.startswith(settings.api_v1_prefix):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.middleware("http")
    async def global_rate_limit(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path.startswith(settings.api_v1_prefix) and request.method != "OPTIONS":
            try:
                limiter.hit(
                    f"global:{client_ip(request)}",
                    settings.max_requests_per_minute,
                    60,
                )
            except Exception:
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": {
                            "code": "rate_limited",
                            "message": "Too many requests. Please slow down.",
                        }
                    },
                )
        return await call_next(request)

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/health", tags=["health"])
    def health():
        db_ok = False
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            db_ok = True
        except Exception:  # noqa: BLE001
            db_ok = False
        return {
            "status": "ok" if db_ok else "degraded",
            "service": "scrapsetu-api",
            "version": "1.0.0",
            "environment": settings.environment,
            "database": "ok" if db_ok else "unavailable",
            "timezone": settings.timezone,
            "integrations": {
                "sms": sms_integration.provider_status(),
                "email": email_integration.provider_status(),
                "storage": storage_status(),
                "maps": maps_integration.provider_status(),
                "payments": payments_integration.provider_status(),
            },
        }

    @app.get("/", include_in_schema=False)
    def root():
        dist_index = REPO_ROOT / "frontend" / "dist" / "index.html"
        if dist_index.exists():
            return FileResponse(dist_index)
        return {
            "name": "ScrapSetu API",
            "message": "API is running. Frontend dev server: http://localhost:5173",
            "docs": "/docs",
            "health": "/health",
        }

    # Serve a production frontend build if present (single-origin deployment).
    dist = REPO_ROOT / "frontend" / "dist"
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str):
            if full_path.startswith(("api/", "docs", "redoc", "openapi.json", "health")):
                return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Not found"}})
            candidate = (dist / full_path).resolve()
            if str(candidate).startswith(str(dist.resolve())) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


app = create_app()

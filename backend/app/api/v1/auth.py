"""Authentication endpoints: phone OTP, refresh rotation, sessions, me."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import (
    REFRESH_COOKIE,
    CurrentUser,
    DbSession,
    assert_same_origin,
    clear_refresh_cookie,
    optional_dealer_profile,
    set_refresh_cookie,
)
from app.core.config import settings
from app.core.errors import UnauthorizedError
from app.core.rate_limit import client_ip
from app.models import User
from app.schemas import (
    MeResponse,
    Message,
    OtpRequestBody,
    OtpRequestResponse,
    OtpVerifyBody,
    RefreshResponse,
    TokenResponse,
    UserBrief,
)
from app.schemas import ProfileRead
from app.services import auth as auth_service
from app.services import notifications
from app.services.serializers import profile_read, user_brief

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/otp/request", response_model=OtpRequestResponse)
def request_otp(payload: OtpRequestBody, request: Request, db: DbSession):
    result = auth_service.request_otp(
        db,
        phone_raw=payload.phone,
        role=payload.role,
        purpose=payload.purpose,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return result


@router.post("/otp/verify", response_model=TokenResponse)
def verify_otp(
    payload: OtpVerifyBody, request: Request, response: Response, db: DbSession
):
    result = auth_service.verify_otp(
        db,
        phone_raw=payload.phone,
        code=payload.code,
        role=payload.role,
        full_name=payload.full_name,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    set_refresh_cookie(
        response,
        result["refresh_token"],
        int((result["refresh_expires_at"] - result["expires_at"]).total_seconds()),
    )
    user: User = result["user"]
    return {
        "access_token": result["access_token"],
        "token_type": "bearer",
        "expires_at": result["expires_at"],
        "user": user_brief(user),
        "is_new_user": result["is_new_user"],
    }


@router.post("/refresh", response_model=RefreshResponse)
def refresh_session(
    request: Request,
    response: Response,
    db: DbSession,
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
):
    assert_same_origin(request)
    if not refresh_cookie:
        raise UnauthorizedError("No refresh session found. Please sign in again.")
    result = auth_service.rotate_refresh_token(
        db,
        refresh_cookie,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    set_refresh_cookie(
        response,
        result["refresh_token"],
        settings.refresh_token_ttl_days * 24 * 3600,
    )
    return {
        "access_token": result["access_token"],
        "token_type": "bearer",
        "expires_at": result["expires_at"],
        "user": user_brief(result["user"]),
    }


@router.post("/logout", response_model=Message)
def logout(
    response: Response,
    db: DbSession,
    user: CurrentUser,
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
):
    auth_service.revoke_session(db, refresh_cookie, user)
    clear_refresh_cookie(response)
    return {"message": "Signed out."}


@router.post("/sessions/revoke-all", response_model=Message)
def revoke_all(
    request: Request,
    response: Response,
    db: DbSession,
    user: CurrentUser,
):
    keep = getattr(request.state, "session_id", None)
    auth_service.revoke_all_sessions(db, user.id, keep_session_id=keep)
    clear_refresh_cookie(response)
    return {"message": "All other sessions were signed out."}


@router.get("/me", response_model=MeResponse)
def me(db: DbSession, user: CurrentUser):
    dealer = optional_dealer_profile(db, user)
    from app.models import DealerProfile
    from sqlalchemy.orm import selectinload
    from sqlalchemy import select

    dealer_summary = None
    if dealer:
        from app.services.dealers import load_dealer

        dealer = load_dealer(db, dealer.id)
        dealer_summary = dealer_summary_dict(dealer)
    return {
        "user": user_brief(user),
        "profile": profile_read(user.profile),
        "dealer": dealer_summary,
        "unread_notifications": notifications.unread_count(db, user.id),
    }


def dealer_summary_dict(dealer) -> dict:  # type: ignore[no-untyped-def]
    from app.services.serializers import dealer_detail

    return dealer_detail(dealer)

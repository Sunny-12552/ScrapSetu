"""Shared FastAPI dependencies: authentication, roles, pagination, cookies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import decode_access_token
from app.core.time import utcnow
from app.db.session import get_db
from app.models import AuthSession, DealerProfile, User, UserStatus

bearer = HTTPBearer(auto_error=False)
REFRESH_COOKIE = "scrapsetu_refresh"

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    request: Request,
    db: DbSession,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> User:
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError("Please sign in to continue.")
    claims = decode_access_token(credentials.credentials)
    session_id = claims.get("sid")
    session = db.get(AuthSession, session_id) if session_id else None
    if not session or session.user_id != claims.get("sub"):
        raise UnauthorizedError("Your session is no longer valid. Please sign in again.")
    if session.revoked_at is not None or session.expires_at <= utcnow():
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    user = db.get(User, claims["sub"])
    if not user:
        raise UnauthorizedError("Account not found.")
    if user.status == UserStatus.SUSPENDED:
        raise ForbiddenError("This account is suspended. Contact support.", code="account_suspended")
    if user.status == UserStatus.DELETED:
        raise ForbiddenError("This account has been deleted.", code="account_deleted")
    request.state.session_id = session.id
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: str):
    def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise ForbiddenError(
                "This action is not available for your account type.",
                code="role_required",
            )
        return user

    return dependency


CustomerUser = Annotated[User, Depends(require_roles("customer"))]
DealerUser = Annotated[User, Depends(require_roles("dealer"))]
AdminUser = Annotated[User, Depends(require_roles("admin"))]


def get_dealer_profile(db: DbSession, user: CurrentUser) -> DealerProfile:
    profile = db.execute(
        select(DealerProfile).where(DealerProfile.user_id == user.id)
    ).scalar_one_or_none()
    if not profile:
        raise ForbiddenError("Complete your dealer application first.")
    return profile


DealerAccount = Annotated[DealerProfile, Depends(get_dealer_profile)]


def optional_dealer_profile(db: Session, user: User) -> DealerProfile | None:
    return db.execute(
        select(DealerProfile).where(DealerProfile.user_id == user.id)
    ).scalar_one_or_none()


class Pagination:
    def __init__(
        self,
        page: int = Query(default=1, ge=1, le=10000),
        page_size: int = Query(default=20, ge=1, le=100),
    ) -> None:
        self.page = page
        self.page_size = page_size
        self.offset = (page - 1) * page_size


Paging = Annotated[Pagination, Depends(Pagination)]


def set_refresh_cookie(response: Response, token: str, max_age_seconds: int) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        max_age=max_age_seconds,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path=f"{settings.api_v1_prefix}/auth",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE,
        path=f"{settings.api_v1_prefix}/auth",
    )


def assert_same_origin(request: Request) -> None:
    """Defence-in-depth for cookie-authenticated endpoints."""
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise ForbiddenError("Request origin is not allowed.", code="origin_rejected")

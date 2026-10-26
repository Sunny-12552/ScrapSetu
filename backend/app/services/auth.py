"""OTP authentication, user provisioning, and refresh-session rotation."""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
    UnauthorizedError,
    ValidationError,
)
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    generate_otp,
    generate_refresh_token,
    hash_otp,
    hash_token,
    normalize_indian_phone,
    verify_otp_hash,
)
from app.core.time import utcnow
from app.integrations import sms as sms_integration
from app.models import AuthSession, OtpChallenge, Role, User, UserProfile, UserStatus

logger = logging.getLogger("scrapsetu.auth")


def _find_user(db: Session, phone: str) -> User | None:
    return db.execute(select(User).where(User.phone == phone)).scalar_one_or_none()


def _create_user(db: Session, phone: str, role: str, full_name: str | None) -> User:
    if role not in (Role.CUSTOMER, Role.DEALER):
        raise ValidationError("Only customer or dealer accounts can self-register.")
    user = User(phone=phone, role=role, status=UserStatus.ACTIVE)
    db.add(user)
    db.flush()
    db.add(
        UserProfile(
            user_id=user.id,
            full_name=full_name.strip() if full_name else None,
            preferred_language="en",
        )
    )
    db.flush()
    db.refresh(user)
    return user


def request_otp(
    db: Session,
    *,
    phone_raw: str,
    role: str,
    purpose: str,
    ip: str,
    user_agent: str | None,
) -> dict:
    try:
        phone = normalize_indian_phone(phone_raw)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    # abuse protection: per-number and per-IP windows
    limiter.hit(f"otp:phone:{phone}", 3, 600)
    limiter.hit(f"otp:ip:{ip}", 12, 600)

    now = utcnow()
    recent = db.execute(
        select(OtpChallenge)
        .where(OtpChallenge.phone == phone, OtpChallenge.consumed_at.is_(None))
        .order_by(OtpChallenge.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if recent and recent.resend_available_at > now:
        wait = int((recent.resend_available_at - now).total_seconds()) + 1
        raise RateLimitError(
            f"Please wait {wait} seconds before requesting another OTP.",
            details={"retry_after_seconds": wait},
        )

    # invalidate previous codes for the same number
    for old in db.execute(
        select(OtpChallenge).where(
            OtpChallenge.phone == phone, OtpChallenge.consumed_at.is_(None)
        )
    ).scalars():
        old.consumed_at = now

    code = generate_otp()
    challenge = OtpChallenge(
        phone=phone,
        code_hash=hash_otp(phone, code),
        purpose=purpose,
        expires_at=now + timedelta(minutes=settings.otp_ttl_minutes),
        resend_available_at=now + timedelta(seconds=settings.otp_resend_seconds),
        max_attempts=settings.otp_max_attempts,
        request_ip=ip,
    )
    db.add(challenge)
    db.commit()

    message = (
        f"{code} is your ScrapSetu verification code. It expires in "
        f"{settings.otp_ttl_minutes} minutes. Do not share this code."
    )
    delivered_via = "development_console"
    try:
        result = sms_integration.send_sms(phone, message)
        delivered_via = "development_console" if result.simulated else result.provider
    except Exception as exc:  # noqa: BLE001
        logger.error("OTP SMS delivery failed: %s", exc)
        if settings.is_production:
            raise ConflictError(
                "We could not send the OTP right now. Please try again shortly.",
                code="otp_delivery_failed",
            ) from exc

    dev_otp = code if (settings.otp_dev_mode and not settings.is_production) else None
    return {
        "phone_masked": phone[:3] + "******" + phone[-2:],
        "expires_in_seconds": settings.otp_ttl_minutes * 60,
        "resend_after_seconds": settings.otp_resend_seconds,
        "delivered_via": delivered_via,
        "dev_otp": dev_otp,
        "message": (
            "Development mode: the OTP is shown here and logged on the API server. "
            "It is never delivered as a real SMS."
            if dev_otp
            else "If this number can be registered, an OTP has been sent."
        ),
    }


def verify_otp(
    db: Session,
    *,
    phone_raw: str,
    code: str,
    role: str,
    full_name: str | None,
    ip: str,
    user_agent: str | None,
) -> dict:
    try:
        phone = normalize_indian_phone(phone_raw)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    limiter.hit(f"otpverify:ip:{ip}", 20, 600)
    limiter.hit(f"otpverify:phone:{phone}", 10, 600)

    challenge = db.execute(
        select(OtpChallenge)
        .where(OtpChallenge.phone == phone, OtpChallenge.consumed_at.is_(None))
        .order_by(OtpChallenge.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if not challenge:
        raise ValidationError(
            "No active OTP found. Please request a new code.", code="otp_missing"
        )
    now = utcnow()
    if challenge.expires_at <= now:
        challenge.consumed_at = now
        db.commit()
        raise ValidationError("This OTP has expired. Request a new one.", code="otp_expired")
    if challenge.attempts >= challenge.max_attempts:
        challenge.consumed_at = now
        db.commit()
        raise RateLimitError(
            "Too many incorrect attempts. Request a new OTP.", code="otp_attempts_exceeded"
        )
    if not verify_otp_hash(phone, code, challenge.code_hash):
        challenge.attempts += 1
        db.commit()
        remaining = challenge.max_attempts - challenge.attempts
        raise ValidationError(
            f"Incorrect OTP. {max(remaining, 0)} attempt(s) remaining.",
            code="otp_invalid",
            details={"attempts_remaining": max(remaining, 0)},
        )

    challenge.consumed_at = now
    user = _find_user(db, phone)
    is_new = False
    if user is None:
        user = _create_user(db, phone, role, full_name)
        is_new = True
    else:
        if user.status == UserStatus.SUSPENDED:
            raise ForbiddenError(
                "This account is suspended. Please contact support.",
                code="account_suspended",
            )
        if user.status == UserStatus.DELETED:
            raise ForbiddenError(
                "This account has been deleted. Please contact support to restore access.",
                code="account_deleted",
            )
        if role == Role.DEALER and user.role == Role.CUSTOMER:
            raise ConflictError(
                "This number is registered as a customer account. "
                "Sign in as a customer, or contact support to upgrade to a dealer account.",
                code="role_mismatch",
            )
        if role == Role.ADMIN and user.role != Role.ADMIN:
            # Never let a phone number be used to probe for administrator accounts.
            raise ForbiddenError(
                "This number is not registered as an administrator account.",
                code="role_mismatch",
            )
        if role == Role.CUSTOMER and user.role == Role.DEALER and user.dealer_profile:
            # Dealers may browse as themselves; the portal is role-driven.
            pass

    if full_name and user.profile and not user.profile.full_name:
        user.profile.full_name = full_name.strip()[:160]

    user.phone_verified_at = now
    user.last_login_at = now

    raw_refresh, refresh_hash = generate_refresh_token()
    session = AuthSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
        user_agent=(user_agent or "")[:255],
        ip_hash=hash_token(ip)[:32],
        last_used_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(user)
    db.refresh(session)

    access_token, expires_at = create_access_token(user.id, user.role, session.id)
    return {
        "access_token": access_token,
        "expires_at": expires_at,
        "refresh_token": raw_refresh,
        "refresh_expires_at": session.expires_at,
        "user": user,
        "is_new_user": is_new,
    }


def rotate_refresh_token(
    db: Session, raw_refresh: str, *, ip: str, user_agent: str | None
) -> dict:
    token_hash = hash_token(raw_refresh)
    session = db.execute(
        select(AuthSession).where(AuthSession.refresh_token_hash == token_hash)
    ).scalar_one_or_none()
    if not session:
        raise UnauthorizedError("Invalid session. Please sign in again.")
    if session.revoked_at is not None:
        # Token reuse after rotation signals possible theft: revoke the family.
        for sibling in db.execute(
            select(AuthSession).where(AuthSession.user_id == session.user_id)
        ).scalars():
            if sibling.revoked_at is None:
                sibling.revoked_at = utcnow()
        db.commit()
        raise UnauthorizedError("This session has been revoked. Please sign in again.")
    if session.expires_at <= utcnow():
        raise UnauthorizedError("Your session has expired. Please sign in again.")

    user = db.get(User, session.user_id)
    if not user or user.status != UserStatus.ACTIVE:
        raise ForbiddenError("This account is not active.")

    new_raw, new_hash = generate_refresh_token()
    new_session = AuthSession(
        user_id=user.id,
        refresh_token_hash=new_hash,
        expires_at=utcnow() + timedelta(days=settings.refresh_token_ttl_days),
        user_agent=(user_agent or "")[:255],
        ip_hash=hash_token(ip)[:32],
        last_used_at=utcnow(),
    )
    db.add(new_session)
    db.flush()
    session.revoked_at = utcnow()
    session.replaced_by_id = new_session.id
    db.commit()
    db.refresh(new_session)

    access_token, expires_at = create_access_token(user.id, user.role, new_session.id)
    return {
        "access_token": access_token,
        "expires_at": expires_at,
        "refresh_token": new_raw,
        "user": user,
    }


def revoke_session(db: Session, raw_refresh: str | None, user: User | None = None) -> None:
    if raw_refresh:
        session = db.execute(
            select(AuthSession).where(
                AuthSession.refresh_token_hash == hash_token(raw_refresh)
            )
        ).scalar_one_or_none()
        if session:
            session.revoked_at = utcnow()
            db.commit()
            return
    if user:
        for session in db.execute(
            select(AuthSession).where(
                AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)
            )
        ).scalars():
            session.revoked_at = utcnow()
        db.commit()


def revoke_all_sessions(db: Session, user_id: str, *, keep_session_id: str | None = None) -> int:
    count = 0
    for session in db.execute(
        select(AuthSession).where(
            AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)
        )
    ).scalars():
        if keep_session_id and session.id == keep_session_id:
            continue
        session.revoked_at = utcnow()
        count += 1
    db.commit()
    return count


def create_admin(db: Session, phone_raw: str, full_name: str = "Administrator") -> User:
    """Secure provisioning used by the CLI only. No default admin exists."""
    phone = normalize_indian_phone(phone_raw)
    existing = _find_user(db, phone)
    if existing:
        if existing.role != Role.ADMIN:
            raise ConflictError("A non-admin account already uses this number.")
        return existing
    user = User(
        phone=phone,
        role=Role.ADMIN,
        status=UserStatus.ACTIVE,
        phone_verified_at=utcnow(),
    )
    db.add(user)
    db.flush()
    db.add(UserProfile(user_id=user.id, full_name=full_name))
    db.commit()
    db.refresh(user)
    return user


def get_user_or_404(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found.")
    return user

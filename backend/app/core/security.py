"""Password/OTP hashing, JWT access tokens, and opaque refresh tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings
from app.core.errors import UnauthorizedError
from app.core.time import utcnow

ALGORITHM = "HS256"


# --- phone numbers -----------------------------------------------------------


def normalize_indian_phone(raw: str) -> str:
    """Return an E.164 Indian mobile number or raise ValueError.

    Accepts ``9876543210``, ``+919876543210``, ``919876543210`` and
    space/dash formatted input. Indian mobiles start with 6-9.
    """
    cleaned = "".join(ch for ch in raw.strip() if ch not in " -()")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if cleaned.startswith("+91"):
        digits = cleaned[3:]
    elif cleaned.startswith("91") and len(cleaned) == 12:
        digits = cleaned[2:]
    else:
        digits = cleaned
    if not digits.isdigit() or len(digits) != 10 or digits[0] not in "6789":
        raise ValueError("Enter a valid 10-digit Indian mobile number.")
    return f"+91{digits}"


def mask_phone(phone: str) -> str:
    if len(phone) < 4:
        return "****"
    return f"{phone[:3]}******{phone[-2:]}"


def mask_name(name: str | None) -> str:
    if not name:
        return "Customer"
    parts = name.strip().split()
    if not parts:
        return "Customer"
    first = parts[0]
    return f"{first[0]}***" + (f" {parts[-1][0]}." if len(parts) > 1 else "")


# --- passwords (future-proofing / admin tools) -------------------------------


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


# --- OTP ---------------------------------------------------------------------


def hash_otp(phone: str, code: str) -> str:
    message = f"{phone}:{code}".encode()
    return hmac.new(settings.secret_key.encode(), message, hashlib.sha256).hexdigest()


def verify_otp_hash(phone: str, code: str, expected: str) -> bool:
    return hmac.compare_digest(hash_otp(phone, code), expected)


def generate_otp(length: int | None = None) -> str:
    length = length or settings.otp_length
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


# --- tokens ------------------------------------------------------------------


def create_access_token(user_id: str, role: str, session_id: str) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=settings.access_token_ttl_minutes)
    claims: dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "sid": session_id,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": uuid.uuid4().hex,
        "iss": "scrapsetu",
    }
    token = jwt.encode(claims, settings.secret_key, algorithm=ALGORITHM)
    return token, expires


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[ALGORITHM],
            issuer="scrapsetu",
            options={"require": ["exp", "sub", "type"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedError(
            "Your session has expired. Please sign in again.", code="token_expired"
        ) from exc
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("Invalid authentication token.") from exc
    if claims.get("type") != "access":
        raise UnauthorizedError("Invalid authentication token.")
    return claims


def generate_refresh_token() -> tuple[str, str]:
    raw = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_reference(prefix: str) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    body = "".join(secrets.choice(alphabet) for _ in range(8))
    return f"{prefix}-{body}"


def utcnow_naive() -> datetime:
    """Deprecated shim retained for compatibility with naive comparisons."""
    return utcnow().replace(tzinfo=None)

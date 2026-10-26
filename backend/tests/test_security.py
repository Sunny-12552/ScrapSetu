"""Unit tests for phone normalisation, tokens, OTP hashing and headers."""

import jwt
import pytest

from app.core.config import settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_otp,
    normalize_indian_phone,
    verify_otp_hash,
)
from app.core.errors import UnauthorizedError


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("9000000001", "+919000000001"),
        ("+91 90000 00001", "+919000000001"),
        ("0091-9000000001", "+919000000001"),
        (" 9000000001 ", "+919000000001"),
    ],
)
def test_indian_phone_normalisation(raw, expected):
    assert normalize_indian_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["12345", "0000000000", "+9112345678901", "abcdefghij", ""],
)
def test_invalid_phones_are_rejected(raw):
    with pytest.raises(ValueError):
        normalize_indian_phone(raw)


def test_otp_hash_is_phone_bound():
    digest = hash_otp("+919000000001", "123456")
    assert verify_otp_hash("+919000000001", "123456", digest)
    assert not verify_otp_hash("+919000000002", "123456", digest)
    assert not verify_otp_hash("+919000000001", "654321", digest)


def test_access_token_round_trip_and_tamper_detection():
    token, _ = create_access_token("user-1", "customer", "session-1")
    claims = decode_access_token(token)
    assert claims["sub"] == "user-1"
    assert claims["role"] == "customer"
    assert claims["sid"] == "session-1"

    tampered = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    with pytest.raises(UnauthorizedError):
        decode_access_token(tampered)


def test_access_token_signed_with_another_key_is_rejected():
    forged = jwt.encode(
        {"sub": "user-1", "role": "admin", "sid": "session-1"},
        "different-secret-key-0123456789abcdef",
        algorithm="HS256",
    )
    with pytest.raises(UnauthorizedError):
        decode_access_token(forged)

def test_cors_origins_accept_comma_separated_and_json():
    from app.core.config import Settings

    comma = Settings(_env_file=None, cors_origins="https://a.example, https://b.example")
    assert comma.cors_origins == ["https://a.example", "https://b.example"]

    json_form = Settings(_env_file=None, cors_origins='["https://a.example", "https://b.example"]')
    assert json_form.cors_origins == ["https://a.example", "https://b.example"]

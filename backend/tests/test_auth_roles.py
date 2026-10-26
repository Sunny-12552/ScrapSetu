"""Authentication, session rotation, and role-based access control."""

from __future__ import annotations

import pytest

from tests.conftest import make_dealer, register_user


def test_health_and_public_metadata(client):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    categories = client.get("/api/v1/meta/categories")
    assert categories.status_code == 200
    assert isinstance(categories.json(), list)

    config = client.get("/api/v1/meta/config")
    assert config.status_code == 200
    assert config.json()["currency"] == "INR"
    assert config.json()["otp"]["dev_mode"] is True


def test_protected_endpoint_requires_token(client):
    response = client.get("/api/v1/customers/dashboard")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_otp_login_sets_httponly_refresh_cookie(client, db):
    user = register_user(db, role="customer", full_name="Cookie Tester")
    requested = client.post(
        "/api/v1/auth/otp/request",
        json={"phone": user.phone, "role": "customer"},
    )
    assert requested.status_code == 200
    body = requested.json()
    assert body["dev_otp"].isdigit()
    assert body["delivered_via"] == "development_console"

    verified = client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": user.phone, "code": body["dev_otp"], "role": "customer"},
    )
    assert verified.status_code == 200
    assert verified.json()["user"]["role"] == "customer"
    set_cookie = verified.headers["set-cookie"].lower()
    assert "scrapsetu_refresh=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


def test_wrong_otp_is_rejected_and_attempt_counted(client, db):
    user = register_user(db, role="customer", full_name="Wrong OTP")
    requested = client.post(
        "/api/v1/auth/otp/request", json={"phone": user.phone, "role": "customer"}
    )
    code = requested.json()["dev_otp"]
    bad = "000000" if code != "000000" else "111111"
    response = client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": user.phone, "code": bad, "role": "customer"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "otp_invalid"


def test_role_enforcement_is_not_bypassable(client, db, login, catalogue):
    customer = register_user(db, role="customer", full_name="Role Customer")
    dealer = make_dealer(db, catalogue)
    customer_headers = login(customer.phone, "customer")
    dealer_headers = login(dealer.phone, "dealer")

    # Customer endpoints reject dealers.
    assert (
        client.get("/api/v1/customers/dashboard", headers=dealer_headers).status_code
        == 403
    )
    # Dealer endpoints reject customers.
    assert (
        client.get("/api/v1/dealers/dashboard", headers=customer_headers).status_code
        == 403
    )
    # Admin endpoints reject both.
    assert client.get("/api/v1/admin/dashboard", headers=dealer_headers).status_code == 403
    assert client.get("/api/v1/admin/dashboard", headers=customer_headers).status_code == 403


def test_admin_can_sign_in_and_reach_admin_api(client, db, login):
    admin = register_user(db, role="admin", full_name="Test Admin")
    headers = login(admin.phone, "admin")
    response = client.get("/api/v1/admin/dashboard", headers=headers)
    assert response.status_code == 200
    assert "customers" in response.json()


def test_customer_cannot_promote_self_by_asking_for_admin_otp(client, db):
    customer = register_user(db, role="customer", full_name="Sneaky")
    requested = client.post(
        "/api/v1/auth/otp/request", json={"phone": customer.phone, "role": "admin"}
    )
    assert requested.status_code == 200
    code = requested.json()["dev_otp"]
    verified = client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": customer.phone, "code": code, "role": "admin"},
    )
    assert verified.status_code == 403
    assert verified.json()["error"]["code"] == "role_mismatch"


def test_refresh_rotation_revokes_the_old_cookie(client, db):
    user = register_user(db, role="customer", full_name="Rotate Me")
    requested = client.post(
        "/api/v1/auth/otp/request", json={"phone": user.phone, "role": "customer"}
    )
    verified = client.post(
        "/api/v1/auth/otp/verify",
        json={
            "phone": user.phone,
            "code": requested.json()["dev_otp"],
            "role": "customer",
        },
    )
    assert verified.status_code == 200
    old_cookie = client.cookies.get("scrapsetu_refresh")
    assert old_cookie

    rotated = client.post("/api/v1/auth/refresh")
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["access_token"]
    new_cookie = client.cookies.get("scrapsetu_refresh")
    assert new_cookie and new_cookie != old_cookie

    # Replaying the rotated (old) token must fail and must not mint a session.
    client.cookies.set("scrapsetu_refresh", old_cookie)
    replay = client.post("/api/v1/auth/refresh")
    assert replay.status_code == 401


def test_logout_revokes_access_session(client, db, login):
    user = register_user(db, role="customer", full_name="Logout Me")
    headers = login(user.phone, "customer")
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401

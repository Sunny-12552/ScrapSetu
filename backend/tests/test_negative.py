"""Negative and abuse-path tests: stale offers, tampering, access, limits."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.time import utcnow
from app.models import Booking, DealerOffer, OfferStatus
from tests.conftest import (
    jpeg_bytes,
    make_dealer,
    offer_payload,
    publish_request,
    register_user,
    request_payload,
    make_address,
)


def test_expired_offer_cannot_be_accepted(client, marketplace, db):
    offer = db.get(DealerOffer, marketplace["offer"]["id"])
    assert offer is not None
    offer.valid_until = utcnow() - timedelta(minutes=1)
    db.commit()

    response = client.post(
        f"/api/v1/offers/{offer.id}/accept",
        headers={**marketplace["customer_headers"], "Idempotency-Key": uuid.uuid4().hex},
    )
    assert response.status_code == 409
    db.refresh(offer)
    assert offer.status == OfferStatus.EXPIRED


def test_dealer_below_minimum_collection_cannot_offer(client, db, login, catalogue):
    customer = register_user(db, role="customer", full_name="Small Load")
    big_dealer = make_dealer(db, catalogue, name="Big Only", min_kg="500")
    address_id = make_address(db, customer, catalogue)
    customer_headers = login(customer.phone, "customer")
    dealer_headers = login(big_dealer.phone, "dealer")
    request = publish_request(
        client, customer_headers, request_payload(address_id, catalogue)
    )
    response = client.post(
        "/api/v1/dealer-offers",
        json=offer_payload(request["id"], request, catalogue),
        headers=dealer_headers,
    )
    assert response.status_code == 403
    assert "eligible" in response.json()["error"]["message"].lower()


def test_dealer_cannot_offer_twice_without_revising(client, marketplace, db, catalogue, login):
    from tests.conftest import make_dealer

    dealer_two = make_dealer(db, catalogue, name="Duplicate Dealer")
    headers = login(dealer_two.phone, "dealer")
    payload = offer_payload(marketplace["request"]["id"], marketplace["request"], catalogue)
    assert client.post("/api/v1/dealer-offers", json=payload, headers=headers).status_code == 201
    duplicate = client.post("/api/v1/dealer-offers", json=payload, headers=headers)
    assert duplicate.status_code == 409
    assert "revise" in duplicate.json()["error"]["message"].lower()


def test_payment_amount_tampering_is_rejected(client, marketplace):
    accepted = client.post(
        f"/api/v1/offers/{marketplace['offer']['id']}/accept",
        headers={**marketplace["customer_headers"], "Idempotency-Key": uuid.uuid4().hex},
    )
    booking_id = accepted.json()["id"]
    dealer_headers = marketplace["dealer_headers"]
    client.post(f"/api/v1/bookings/{booking_id}/confirm", headers=dealer_headers)
    client.post(f"/api/v1/bookings/{booking_id}/start-pickup", headers=dealer_headers)
    weights = [
        {"category_id": item["category_id"], "actual_weight_kg": "5"}
        for item in marketplace["offer"]["items"]
    ]
    client.post(
        f"/api/v1/bookings/{booking_id}/record-weighing",
        headers=dealer_headers,
        json={"items": weights},
    )
    settled = client.post(
        f"/api/v1/bookings/{booking_id}/submit-settlement",
        headers=dealer_headers,
        json={"items": weights, "deductions": "0"},
    )
    assert settled.status_code == 200, settled.text
    final_payout = settled.json()["settlement"]["final_payout"]

    underpaid = client.post(
        f"/api/v1/bookings/{booking_id}/record-payment",
        headers=dealer_headers,
        json={"method": "cash", "amount": "1.00"},
    )
    assert underpaid.status_code == 422
    assert "final payout" in underpaid.json()["error"]["message"].lower()

    wrong_order = client.post(
        f"/api/v1/bookings/{booking_id}/record-weighing",
        headers=dealer_headers,
        json={"items": weights},
    )
    assert wrong_order.status_code == 409


def test_cannot_confirm_payment_before_dealer_records_it(client, marketplace):
    accepted = client.post(
        f"/api/v1/offers/{marketplace['offer']['id']}/accept",
        headers={**marketplace["customer_headers"], "Idempotency-Key": uuid.uuid4().hex},
    )
    booking_id = accepted.json()["id"]
    response = client.post(
        f"/api/v1/bookings/{booking_id}/confirm-payment",
        headers=marketplace["customer_headers"],
        json={},
    )
    assert response.status_code in (404, 409)


def test_private_image_is_not_readable_by_another_customer(
    client, marketplace, db, catalogue, login
):
    image_url = marketplace["request"]["images"][0]["url"]
    other = register_user(db, role="customer", full_name="Nosy Neighbour")
    other_headers = login(other.phone, "customer")
    response = client.get(image_url, headers=other_headers)
    assert response.status_code == 403

    owner = client.get(image_url, headers=marketplace["customer_headers"])
    assert owner.status_code == 200
    assert owner.headers["content-type"].startswith("image/")


def test_dealer_cannot_read_unrelated_customer_files(
    client, marketplace, db, catalogue, login
):
    from tests.conftest import make_dealer

    image_url = marketplace["request"]["images"][0]["url"]

    # An eligible dealer in the same city can preview photos to prepare a quote.
    assert client.get(
        image_url, headers=marketplace["dealer_headers"]
    ).status_code == 200

    # A dealer who does not handle the requested materials must not get access.
    outsider = make_dealer(
        db, catalogue, name="Outsider Dealer", category_slugs=("e_waste",)
    )
    outside_headers = login(outsider.phone, "dealer")
    response = client.get(image_url, headers=outside_headers)
    assert response.status_code == 403


def test_invalid_image_upload_is_rejected(client, db, login, catalogue):
    customer = register_user(db, role="customer", full_name="Bad Upload")
    address_id = make_address(db, customer, catalogue)
    headers = login(customer.phone, "customer")
    created = client.post(
        "/api/v1/scrap-requests",
        json=request_payload(address_id, catalogue),
        headers=headers,
    )
    assert created.status_code == 201
    request_id = created.json()["id"]
    response = client.post(
        f"/api/v1/scrap-requests/{request_id}/images",
        headers=headers,
        files={"files": ("evil.exe", b"MZ do not run", "application/octet-stream")},
    )
    assert response.status_code == 422


def test_duplicate_material_lines_are_rejected(client, db, login, catalogue):
    customer = register_user(db, role="customer", full_name="Duplicate Lines")
    address_id = make_address(db, customer, catalogue)
    headers = login(customer.phone, "customer")
    payload = request_payload(address_id, catalogue)
    payload["items"] = [payload["items"][0], payload["items"][0]]
    response = client.post("/api/v1/scrap-requests", json=payload, headers=headers)
    assert response.status_code == 422

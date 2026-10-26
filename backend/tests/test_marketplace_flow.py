"""End-to-end marketplace flow through the HTTP API."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from app.core.time import utcnow


def _accept(client, headers, offer_id):
    return client.post(
        f"/api/v1/offers/{offer_id}/accept",
        headers={**headers, "Idempotency-Key": uuid.uuid4().hex},
    )


def test_full_lifecycle_from_offer_to_review(client, marketplace):
    customer_headers = marketplace["customer_headers"]
    dealer_headers = marketplace["dealer_headers"]
    offer = marketplace["offer"]

    accepted = _accept(client, customer_headers, offer["id"])
    assert accepted.status_code == 200, accepted.text
    booking = accepted.json()
    assert booking["status"] == "offer_selected"
    assert booking["accepted_payout"] == offer["estimated_payout"]
    assert booking["offer_snapshot"]["offer_version"] == offer["version"]
    booking_id = booking["id"]

    # A second attempt to accept any offer for the same request is rejected.
    assert _accept(client, customer_headers, offer["id"]).status_code == 409

    confirmed = client.post(
        f"/api/v1/bookings/{booking_id}/confirm", headers=dealer_headers
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "booking_confirmed"

    pickup = client.post(
        f"/api/v1/bookings/{booking_id}/start-pickup", headers=dealer_headers
    )
    assert pickup.status_code == 200, pickup.text
    assert pickup.json()["status"] == "pickup_in_progress"

    weights = {
        item["category_id"]: "9.500"
        for item in offer["items"]
    }
    measured = client.post(
        f"/api/v1/bookings/{booking_id}/record-weighing",
        headers=dealer_headers,
        json={
            "items": [
                {"category_id": category_id, "actual_weight_kg": weight}
                for category_id, weight in weights.items()
            ],
            "notes": "Digital scale.",
        },
    )
    assert measured.status_code == 200, measured.text
    assert measured.json()["status"] == "weighing_recorded"

    settled = client.post(
        f"/api/v1/bookings/{booking_id}/submit-settlement",
        headers=dealer_headers,
        json={
            "items": [
                {"category_id": category_id, "actual_weight_kg": weight}
                for category_id, weight in weights.items()
            ],
            "deductions": "0",
            "notes": "Rate unchanged.",
        },
    )
    assert settled.status_code == 200, settled.text
    body = settled.json()
    assert body["status"] == "settlement_pending"
    settlement = body["settlement"]
    assert settlement is not None
    assert settlement["status"] == "submitted"
    payout = settlement["final_payout"]

    # Dealer cannot confirm their own settlement.
    assert (
        client.post(
            f"/api/v1/bookings/{booking_id}/confirm-settlement",
            headers=dealer_headers,
            json={"approve": True},
        ).status_code
        == 403
    )

    approved = client.post(
        f"/api/v1/bookings/{booking_id}/confirm-settlement",
        headers=customer_headers,
        json={"approve": True, "note": "Weights match."},
    )
    assert approved.status_code == 200, approved.text

    payment = client.post(
        f"/api/v1/bookings/{booking_id}/record-payment",
        headers=dealer_headers,
        json={
            "method": "upi",
            "amount": payout,
            "upi_reference": "UPI-TEST-123",
        },
    )
    assert payment.status_code == 200, payment.text
    payments = payment.json()["payments"]
    assert len(payments) == 1
    assert payments[0]["status"] == "recorded"
    assert payments[0]["gateway_verified"] is False

    completed = client.post(
        f"/api/v1/bookings/{booking_id}/confirm-payment",
        headers=customer_headers,
        json={},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"

    # The listing closes and the accepted offer is locked.
    request = client.get(
        f"/api/v1/scrap-requests/{marketplace['request']['id']}",
        headers=customer_headers,
    )
    assert request.status_code == 200
    assert request.json()["status"] == "completed"

    review = client.post(
        "/api/v1/reviews",
        headers=customer_headers,
        json={
            "booking_id": booking_id,
            "rating": 5,
            "comment": "Fair weights and prompt payment.",
        },
    )
    assert review.status_code == 201, review.text
    assert review.json()["rating"] == 5

    duplicate = client.post(
        "/api/v1/reviews",
        headers=customer_headers,
        json={"booking_id": booking_id, "rating": 4, "comment": "Second review."},
    )
    assert duplicate.status_code == 409

    # Customer notification feed has entries for the lifecycle.
    notifications = client.get(
        "/api/v1/notifications", headers=customer_headers
    )
    assert notifications.status_code == 200
    assert notifications.json()["total"] >= 1


def test_idempotent_accept_returns_the_same_booking(client, marketplace):
    key = uuid.uuid4().hex
    headers = {**marketplace["customer_headers"], "Idempotency-Key": key}
    first = client.post(
        f"/api/v1/offers/{marketplace['offer']['id']}/accept", headers=headers
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/v1/offers/{marketplace['offer']['id']}/accept", headers=headers
    )
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]


def test_customer_sees_richer_offer_list_and_can_compare(client, marketplace, db, catalogue, login):
    from tests.conftest import make_dealer

    dealer_two = make_dealer(db, catalogue, name="Dealer Two", min_kg="1")
    dealer_headers_two = login(dealer_two.phone, "dealer")
    offer = client.post(
        "/api/v1/dealer-offers",
        json={
            "request_id": marketplace["request"]["id"],
            "items": [
                {
                    "category_id": item["category_id"],
                    "rate_per_kg": "30.00",
                    "estimated_weight_kg": item["estimated_weight_kg"],
                }
                for item in marketplace["request"]["items"]
            ],
            "min_total_weight_kg": "0",
            "pickup_date": marketplace["request"]["preferred_date"],
            "pickup_window": marketplace["request"]["time_window"],
            "valid_until": (utcnow() + timedelta(hours=12)).isoformat(),
        },
        headers=dealer_headers_two,
    )
    assert offer.status_code == 201, offer.text

    offers = client.get(
        f"/api/v1/scrap-requests/{marketplace['request']['id']}/offers?sort=payout",
        headers=marketplace["customer_headers"],
    )
    assert offers.status_code == 200, offers.text
    payload = offers.json()
    assert len(payload) == 2
    assert float(payload[0]["estimated_payout"]) >= float(payload[1]["estimated_payout"])
    assert payload[0]["dealer"]["business_name"] in {"Dealer One", "Dealer Two"}
    # Public dealer cards must not leak private business identifiers.
    assert "gstin" not in payload[0]["dealer"]
    assert "pan" not in payload[0]["dealer"]


def test_customer_cannot_read_another_customers_request(client, marketplace, db, catalogue, login):
    from tests.conftest import register_user

    other = register_user(db, role="customer", full_name="Other Customer")
    other_headers = login(other.phone, "customer")
    response = client.get(
        f"/api/v1/scrap-requests/{marketplace['request']['id']}", headers=other_headers
    )
    assert response.status_code == 403

    offers = client.get(
        f"/api/v1/scrap-requests/{marketplace['request']['id']}/offers",
        headers=other_headers,
    )
    assert offers.status_code == 403

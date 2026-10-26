"""Exclusive offer acceptance: exactly one live booking per listing.

The accept endpoint relies on two layers: a row lock on the offer/request and
the partial unique index ``uq_booking_active_request``. SQLite (used in tests)
does not honour ``SELECT ... FOR UPDATE``, so the DB invariant is what makes
the guarantee portable. These tests pin both behaviours.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Booking


def _accept(client, headers, offer_id):
    return client.post(
        f"/api/v1/offers/{offer_id}/accept",
        headers={**headers, "Idempotency-Key": uuid.uuid4().hex},
    )


def test_second_accept_never_creates_a_second_booking(client, marketplace):
    headers = marketplace["customer_headers"]
    offer_id = marketplace["offer"]["id"]

    first = _accept(client, headers, offer_id)
    assert first.status_code == 200, first.text
    booking_id = first.json()["id"]

    second = _accept(client, headers, offer_id)
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "already_booked"


def test_db_index_rejects_a_second_live_booking(client, marketplace, db):
    accepted = _accept(client, marketplace["customer_headers"], marketplace["offer"]["id"])
    assert accepted.status_code == 200, accepted.text

    original = db.get(Booking, accepted.json()["id"])
    assert original is not None

    duplicate = {
        "id": str(uuid.uuid4()),
        "reference": f"SSB-QA{uuid.uuid4().hex[:6].upper()}",
        "request_id": original.request_id,
        "customer_id": original.customer_id,
        "dealer_id": original.dealer_id,
        "offer_id": original.offer_id,
        "snapshot_id": original.snapshot_id,
        "status": "booking_confirmed",
        "scheduled_date": original.scheduled_date,
        "time_window": original.time_window,
        "accepted_payout": original.accepted_payout,
        "version": 1,
        "created_at": original.created_at,
        "updated_at": original.updated_at,
    }

    with pytest.raises(IntegrityError):
        db.execute(Booking.__table__.insert().values(**duplicate))
        db.commit()
    db.rollback()

    # The original booking is untouched and still the only live one.
    live = (
        db.query(Booking)
        .filter(
            Booking.request_id == original.request_id,
            Booking.status.notin_(("cancelled", "failed")),
        )
        .all()
    )
    assert [row.id for row in live] == [original.id]

"""Administrator surfaces: dashboard aggregates, moderation, audit, exports."""

from __future__ import annotations

from decimal import Decimal

from app.models import (
    AuditLog,
    DealerProfile,
    DealerVerificationDocument,
    MaterialCategory,
    User,
)
from tests.conftest import make_dealer, register_user


def _admin(db, login):
    admin = register_user(db, role="admin", full_name="Admin User")
    return admin, login(admin.phone, "admin")


def test_admin_dashboard_uses_real_aggregates(client, db, login):
    admin, headers = _admin(db, login)
    response = client.get("/api/v1/admin/dashboard", headers=headers)
    assert response.status_code == 200
    body = response.json()
    for key in (
        "customers",
        "dealers_verified",
        "dealers_pending",
        "new_requests",
        "offers_received",
        "bookings_in_progress",
        "completed_collections",
        "gross_transaction_value",
        "platform_revenue",
        "definitions",
    ):
        assert key in body
    assert body["customers"] >= 0
    assert body["platform_revenue"] == "0.00"


def test_dealer_approval_requires_documents_and_records_audit(client, db, login, catalogue):
    admin, headers = _admin(db, login)
    dealer_user = register_user(db, role="dealer", full_name="Pending Dealer")
    profile = DealerProfile(
        user_id=dealer_user.id,
        business_name="Pending Metals",
        contact_person="Pending Metals",
        city_id=catalogue["city_id"],
        status="submitted",
        min_collection_kg=Decimal("5"),
        operating_hours={},
    )
    db.add(profile)
    db.flush()
    from app.models import DealerCategory, DealerServiceArea

    db.add(
        DealerCategory(
            dealer_id=profile.id,
            category_id=catalogue["categories"]["iron"].id,
        )
    )
    db.add(
        DealerServiceArea(
            dealer_id=profile.id,
            city_id=catalogue["city_id"],
            locality=None,
            pincode_prefixes=[],
        )
    )
    db.commit()

    # No documents yet: approval must fail with an actionable message.
    missing = client.post(
        f"/api/v1/admin/dealers/{profile.id}/approve",
        headers=headers,
        json={"reason": "Looks good"},
    )
    assert missing.status_code == 422
    assert "document" in missing.json()["error"]["message"].lower()

    db.add(
        DealerVerificationDocument(
            dealer_id=profile.id,
            doc_type="gst_certificate",
            file_key=f"dealer-docs/{profile.id}/demo.pdf",
            file_name="gst.pdf",
            mime_type="application/pdf",
            size_bytes=10,
            status="pending",
        )
    )
    db.commit()

    approved = client.post(
        f"/api/v1/admin/dealers/{profile.id}/approve",
        headers=headers,
        json={"reason": "Documents verified"},
    )
    assert approved.status_code == 200, approved.text
    db.expire_all()
    refreshed = db.get(DealerProfile, profile.id)
    assert refreshed.status == "approved"

    logs = client.get(
        "/api/v1/admin/audit-logs?action=dealer.approved", headers=headers
    )
    assert logs.status_code == 200
    assert logs.json()["total"] >= 1


def test_csv_export_streams_with_attachment_header(client, db, login):
    _admin_user, headers = _admin(db, login)
    response = client.get("/api/v1/admin/exports/bookings", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert b"reference" in response.content.lower()


def test_fee_rule_can_only_be_created_by_admin(client, db, login):
    customer = register_user(db, role="customer", full_name="Fee Customer")
    customer_headers = login(customer.phone, "customer")
    payload = {
        "name": "Test fee",
        "fee_type": "percent",
        "applies_to": "customer",
        "value": "1.5",
        "effective_from": "2026-01-01",
    }
    assert (
        client.post(
            "/api/v1/admin/fee-rules", json=payload, headers=customer_headers
        ).status_code
        == 403
    )
    _admin_user, admin_headers = _admin(db, login)
    created = client.post("/api/v1/admin/fee-rules", json=payload, headers=admin_headers)
    assert created.status_code == 201, created.text
    assert created.json()["fee_type"] == "percent"


def test_admin_can_list_and_filter_users(client, db, login):
    _admin_user, headers = _admin(db, login)
    response = client.get("/api/v1/admin/users?role=customer&page_size=5", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["page_size"] == 5
    assert all(item["role"] == "customer" for item in body["items"])

def test_csv_export_neutralises_spreadsheet_formulas(client, db, login):
    from app.services.admin import _csv_response

    admin, headers = _admin(db, login)
    response = client.get("/api/v1/admin/exports/audit-logs", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")

    content, _filename = _csv_response(
        [["=HYPERLINK(\"http://evil\")", "+91 90000 00000", 12]],
        ["reason", "phone", "count"],
    )
    text = content.decode("utf-8-sig")
    assert "'=HYPERLINK" in text
    assert "'+91 90000 00000" in text
    assert ",12" in text

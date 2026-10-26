"""Test fixtures: isolated database, app client, users and catalogue."""

from __future__ import annotations

import io
import os
import uuid
from collections.abc import Iterator
from datetime import date, timedelta
from decimal import Decimal

import pytest

# Must be set before importing application settings.
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///./test_scrapsetu.db"
os.environ["STORAGE_DIR"] = "./var/test-uploads"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["ENABLE_SCHEDULER"] = "false"
os.environ["OTP_DEV_MODE"] = "true"
os.environ["SECRET_KEY"] = "test-only-secret-key-0123456789abcdef0123456789abcdef"
os.environ["ALLOW_DEMO_SEED"] = "true"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.core.constants import DEFAULT_OPERATING_HOURS, local_today  # noqa: E402
from app.core.time import utcnow  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    City,
    DealerCategory,
    DealerProfile,
    DealerServiceArea,
    MaterialCategory,
    MaterialPriceReference,
    User,
    UserProfile,
    UserStatus,
)

_counter = iter(range(1, 100000))


def unique_phone() -> str:
    return f"+9198{next(_counter):08d}"


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    engine.dispose()
    for path in ("test_scrapsetu.db", "test_scrapsetu.db-wal", "test_scrapsetu.db-shm"):
        if os.path.exists(path):
            os.remove(path)


@pytest.fixture()
def db() -> Iterator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def catalogue(_database: None) -> dict:
    session = SessionLocal()
    try:
        city = session.query(City).filter_by(slug="hyderabad-test").one_or_none()
        if city is None:
            city = City(
                name="Hyderabad",
                state="Telangana",
                slug="hyderabad-test",
                timezone="Asia/Kolkata",
                is_active=True,
            )
            session.add(city)
            session.flush()
        categories = {}
        specs = [
            ("iron", "Iron & Steel", "22.00", "31.00", False),
            ("copper", "Copper", "610.00", "735.00", False),
            ("paper", "Paper", "9.00", "16.00", False),
            ("e_waste", "E-Waste", "55.00", "120.00", True),
        ]
        for index, (slug, name, low, high, special) in enumerate(specs, start=1):
            category = session.query(MaterialCategory).filter_by(slug=slug).one_or_none()
            if category is None:
                category = MaterialCategory(
                    slug=slug,
                    name=name,
                    unit="kg",
                    icon="recycle",
                    is_active=True,
                    requires_special_handling=special,
                    sort_order=index,
                )
                session.add(category)
                session.flush()
                session.add(
                    MaterialPriceReference(
                        category_id=category.id,
                        city_id=city.id,
                        indicative_min_rate=Decimal(low),
                        indicative_max_rate=Decimal(high),
                        effective_from=local_today(),
                    )
                )
            categories[slug] = category
        session.commit()
        return {"city_id": city.id, "categories": categories}
    finally:
        session.close()


def register_user(
    db,
    *,
    role: str,
    full_name: str,
    email: str | None = None,
    phone: str | None = None,
) -> User:
    phone = phone or unique_phone()
    user = User(
        phone=phone,
        role=role,
        status=UserStatus.ACTIVE,
        phone_verified_at=utcnow(),
    )
    db.add(user)
    db.flush()
    db.add(
        UserProfile(
            user_id=user.id,
            full_name=full_name,
            email=email or f"{uuid.uuid4().hex[:8]}@example.com",
            preferred_language="en",
        )
    )
    db.commit()
    db.refresh(user)
    return user


def make_dealer(
    db,
    catalogue: dict,
    *,
    name: str = "Test Dealer",
    category_slugs: tuple[str, ...] = ("iron", "copper", "paper"),
    locality: str | None = None,
    min_kg: str = "1",
) -> User:
    user = register_user(db, role="dealer", full_name=name)
    profile = DealerProfile(
        user_id=user.id,
        business_name=name,
        contact_person=name,
        city_id=catalogue["city_id"],
        locality=locality,
        status="approved",
        min_collection_kg=Decimal(min_kg),
        accepts_new_requests=True,
        operating_hours=DEFAULT_OPERATING_HOURS,
        verified_at=utcnow(),
        rating_avg=Decimal("4.50"),
        rating_count=2,
        completed_jobs=3,
    )
    db.add(profile)
    db.flush()
    for slug in category_slugs:
        db.add(
            DealerCategory(
                dealer_id=profile.id,
                category_id=catalogue["categories"][slug].id,
            )
        )
    db.add(
        DealerServiceArea(
            dealer_id=profile.id,
            city_id=catalogue["city_id"],
            locality=locality,
            pincode_prefixes=[],
        )
    )
    db.commit()
    db.refresh(user)
    return user


def make_address(db, user: User, catalogue: dict, *, locality: str = "Madhapur") -> str:
    from app.models import CustomerAddress

    address = CustomerAddress(
        customer_id=user.id,
        label="Home",
        contact_name=user.profile.full_name or "Customer",
        contact_phone=user.phone,
        line1="Flat 1, Test Residency",
        locality=locality,
        city_id=catalogue["city_id"],
        postal_code="500081",
        is_default=True,
        is_active=True,
    )
    db.add(address)
    db.commit()
    db.refresh(address)
    return address.id


@pytest.fixture()
def login(client: TestClient):
    def _login(phone: str, role: str = "customer") -> dict[str, str]:
        response = client.post(
            "/api/v1/auth/otp/request",
            json={"phone": phone, "role": role, "purpose": "login"},
        )
        assert response.status_code == 200, response.text
        code = response.json()["dev_otp"]
        assert code
        verified = client.post(
            "/api/v1/auth/otp/verify",
            json={"phone": phone, "code": code, "role": role},
        )
        assert verified.status_code == 200, verified.text
        token = verified.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _login


def jpeg_bytes(color: tuple[int, int, int] = (90, 110, 90)) -> bytes:
    image = Image.new("RGB", (320, 240), color)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=80)
    return buffer.getvalue()


def request_payload(address_id: str, catalogue: dict, *, days_ahead: int = 2) -> dict:
    return {
        "address_id": address_id,
        "preferred_date": (local_today() + timedelta(days=days_ahead)).isoformat(),
        "time_window": "morning",
        "customer_notes": "Test pickup.",
        "items": [
            {
                "category_id": catalogue["categories"]["iron"].id,
                "estimated_weight_kg": "10",
                "quantity_unit": "kg",
            },
            {
                "category_id": catalogue["categories"]["copper"].id,
                "estimated_weight_kg": "2",
                "quantity_unit": "kg",
            },
        ],
    }


def offer_payload(request_id: str, request: dict, catalogue: dict, *, iron_rate: str = "26.00") -> dict:
    return {
        "request_id": request_id,
        "items": [
            {
                "category_id": item["category_id"],
                "rate_per_kg": iron_rate if item["category_id"] == catalogue["categories"]["iron"].id else "680.00",
                "estimated_weight_kg": item["estimated_weight_kg"],
            }
            for item in request["items"]
        ],
        "min_total_weight_kg": "0",
        "pickup_date": request["preferred_date"],
        "pickup_window": request["time_window"],
        "valid_until": (utcnow() + timedelta(hours=24)).isoformat(),
        "conditions": "Test offer.",
    }


def publish_request(client: TestClient, headers: dict, payload: dict) -> dict:
    created = client.post("/api/v1/scrap-requests", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    request = created.json()
    upload = client.post(
        f"/api/v1/scrap-requests/{request['id']}/images",
        headers=headers,
        files={"files": ("scrap.jpg", jpeg_bytes(), "image/jpeg")},
    )
    assert upload.status_code == 201, upload.text
    submitted = client.post(
        f"/api/v1/scrap-requests/{request['id']}/submit", headers=headers
    )
    assert submitted.status_code == 200, submitted.text
    return submitted.json()


@pytest.fixture()
def marketplace(db, client, login, catalogue):
    """A published request with one eligible dealer and a submitted offer."""
    customer = register_user(db, role="customer", full_name="Test Customer")
    dealer_user = make_dealer(db, catalogue, name="Dealer One")
    address_id = make_address(db, customer, catalogue)
    customer_headers = login(customer.phone, "customer")
    dealer_headers = login(dealer_user.phone, "dealer")
    request = publish_request(
        client, customer_headers, request_payload(address_id, catalogue)
    )
    offer = client.post(
        "/api/v1/dealer-offers",
        json=offer_payload(request["id"], request, catalogue),
        headers=dealer_headers,
    )
    assert offer.status_code == 201, offer.text
    return {
        "customer": customer,
        "dealer": dealer_user,
        "customer_headers": customer_headers,
        "dealer_headers": dealer_headers,
        "request": request,
        "offer": offer.json(),
        "address_id": address_id,
    }

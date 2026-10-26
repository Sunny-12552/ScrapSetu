"""ScrapSetu command line utilities.

Usage (run from ``scrapsetu/backend``)::

    python -m app.cli seed-demo
    python -m app.cli create-admin --phone +919876543210 --name "Ops Admin"
    python -m app.cli expire-sweep

There is deliberately no default administrator password: administrators sign in
with the same phone OTP flow as everyone else.
"""

from __future__ import annotations

import argparse
import io
import sys
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.core.config import settings
from app.core.constants import local_today
from app.core.errors import AppError
from app.core.security import normalize_indian_phone
from app.core.time import utcnow
from app.db.session import SessionLocal
from app.models import (
    City,
    CustomerAddress,
    DealerProfile,
    DealerServiceArea,
    MaterialCategory,
    MaterialPriceReference,
    Role,
    ScrapImage,
    ScrapRequest,
    SupportTicket,
    User,
    UserProfile,
    UserStatus,
)
from app.schemas import (
    DealerApplication,
    DealerAvailabilityUpdate,
    OfferCreate,
    OfferItemIn,
    RecordPaymentBody,
    RecordWeighingBody,
    RequestCreate,
    RequestItemIn,
    ReviewCreate,
    SubmitSettlementBody,
    SupportTicketCreate,
    WeighingItemIn,
)
from app.services import admin as admin_service
from app.services import dealers as dealer_service
from app.services import engagement
from app.services import offers as offer_service
from app.services import requests as request_service
from app.services import bookings as booking_service
from app.integrations.storage import save_document, save_image

DEMO_PASSWORD_NOTE = "Phone OTP only. Use the dev OTP shown by the API in development."

CATALOGUE = [
    ("iron", "Iron & Steel", "Structural iron, rods, gates and heavy steel scrap.", "recycle", False, 1),
    ("aluminium", "Aluminium", "Aluminium sheets, profiles, utensils and cable scrap.", "layers", False, 2),
    ("copper", "Copper", "Copper wire, pipes and fittings. High value, weighed carefully.", "bolt", False, 3),
    ("brass", "Brass", "Brass fittings, valves and utensils.", "hexagon", False, 4),
    ("paper", "Paper & Cardboard", "Newspapers, cartons and office paper. Keep dry.", "file-text", False, 5),
    ("plastic", "Plastic", "PET bottles, hard plastics and mixed plastic scrap.", "package", False, 6),
    ("e_waste", "E-Waste", "Old electronics, cables and small appliances.", "cpu", True, 7),
    ("battery", "Batteries", "Lead-acid and lithium batteries. Special handling required.", "battery-charging", True, 8),
]

PRICES = {
    "iron": ("22.00", "31.00"),
    "aluminium": ("118.00", "148.00"),
    "copper": ("610.00", "735.00"),
    "brass": ("395.00", "470.00"),
    "paper": ("9.00", "16.00"),
    "plastic": ("18.00", "34.00"),
    "e_waste": ("55.00", "120.00"),
    "battery": ("65.00", "95.00"),
}

DEMO_USERS = [
    ("+919000000001", Role.CUSTOMER, "Ananya Rao", "ananya.demo@example.com"),
    ("+919000000002", Role.CUSTOMER, "Vikram Shetty", "vikram.demo@example.com"),
    ("+919000000101", Role.DEALER, "Ravi Kumar", "ravi.demo@example.com"),
    ("+919000000102", Role.DEALER, "Meena Traders", "meena.demo@example.com"),
    ("+919000000103", Role.DEALER, "GreenLoop Recycling", "greenloop.demo@example.com"),
    ("+919000000999", Role.ADMIN, "ScrapSetu Admin", "admin.demo@example.com"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok(message: str) -> None:
    print(f"  [ok] {message}")


def _skip(message: str) -> None:
    print(f"  [skip] {message}")


def ensure_city(db, *, name: str = "Hyderabad", state: str = "Telangana", slug: str = "hyderabad") -> City:
    city = db.execute(select(City).where(City.slug == slug)).scalar_one_or_none()
    if city:
        return city
    city = City(name=name, state=state, slug=slug, timezone="Asia/Kolkata", is_active=True)
    db.add(city)
    db.commit()
    db.refresh(city)
    _ok(f"city {city.name}")
    return city


def ensure_user(db, phone: str, role: str, full_name: str | None, email: str | None) -> User:
    phone = normalize_indian_phone(phone)
    user = db.execute(select(User).where(User.phone == phone)).scalar_one_or_none()
    if user:
        return user
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
            email=email,
            preferred_language="en",
        )
    )
    db.commit()
    _ok(f"{role} {phone} ({full_name})")
    return user


def ensure_catalogue(db, city: City) -> dict[str, MaterialCategory]:
    categories: dict[str, MaterialCategory] = {}
    added = 0
    for slug, name, description, icon, special, order in CATALOGUE:
        category = db.execute(
            select(MaterialCategory).where(MaterialCategory.slug == slug)
        ).scalar_one_or_none()
        if not category:
            category = MaterialCategory(
                slug=slug,
                name=name,
                description=description,
                unit="kg",
                icon=icon,
                is_active=True,
                requires_special_handling=special,
                sort_order=order,
            )
            db.add(category)
            db.flush()
            added += 1
        categories[slug] = category
    db.commit()
    if added:
        _ok(f"{added} material categories")

    priced = 0
    today = local_today()
    for slug, category in categories.items():
        exists = db.execute(
            select(MaterialPriceReference.id).where(
                MaterialPriceReference.category_id == category.id,
                MaterialPriceReference.city_id == city.id,
                MaterialPriceReference.effective_from == today,
            )
        ).first()
        if exists:
            continue
        low, high = PRICES[slug]
        db.add(
            MaterialPriceReference(
                category_id=category.id,
                city_id=city.id,
                indicative_min_rate=Decimal(low),
                indicative_max_rate=Decimal(high),
                effective_from=today,
                created_by=None,
            )
        )
        priced += 1
    db.commit()
    if priced:
        _ok(f"{priced} indicative price references for {city.name}")
    return categories


def ensure_address(db, customer: User, city: City, *, label: str, locality: str, pincode: str, line1: str) -> CustomerAddress:
    address = db.execute(
        select(CustomerAddress).where(
            CustomerAddress.customer_id == customer.id,
            CustomerAddress.locality == locality,
            CustomerAddress.is_active.is_(True),
        )
    ).scalar_one_or_none()
    if address:
        return address
    address = CustomerAddress(
        customer_id=customer.id,
        label=label,
        contact_name=customer.profile.full_name or "Customer",
        contact_phone=customer.phone,
        line1=line1,
        locality=locality,
        city_id=city.id,
        postal_code=pincode,
        is_default=not db.execute(
            select(CustomerAddress.id).where(CustomerAddress.customer_id == customer.id)
        ).first(),
        is_active=True,
    )
    db.add(address)
    db.commit()
    db.refresh(address)
    _ok(f"address for {customer.phone} in {locality}")
    return address


def _demo_pdf() -> bytes:
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R>>endobj\n"
        b"4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 100 Td (ScrapSetu demo) Tj ET\nendstream endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )


def _demo_jpeg(seed: int) -> bytes:
    from PIL import Image, ImageDraw

    colors = [(120, 130, 120), (90, 110, 130), (140, 120, 90), (100, 100, 110)]
    image = Image.new("RGB", (640, 480), colors[seed % len(colors)])
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, 600, 440), outline=(255, 255, 255), width=4)
    draw.text((60, 220), "ScrapSetu demo photo", fill=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=82)
    return buffer.getvalue()


def ensure_dealer(
    db,
    *,
    user: User,
    admin: User,
    city: City,
    categories: dict[str, MaterialCategory],
    business_name: str,
    locality: str,
    min_kg: str,
    category_slugs: list[str],
) -> DealerProfile:
    existing = db.execute(
        select(DealerProfile).where(DealerProfile.user_id == user.id)
    ).scalar_one_or_none()
    if existing and existing.status == "approved":
        return existing

    payload = DealerApplication(
        business_name=business_name,
        contact_person=user.profile.full_name or business_name,
        email=user.profile.email,
        address_line=f"Plot 12, {locality}",
        city_id=city.id,
        locality=locality,
        postal_code="500081",
        description=(
            "Verified scrap buyer serving Hyderabad. Digital weighing, "
            "transparent rates and same-day pickup."
        ),
        min_collection_kg=Decimal(min_kg),
        category_ids=[categories[s].id for s in category_slugs],
        service_areas=[locality, "Gachibowli", "Kondapur"],
    )
    dealer = dealer_service.apply_application(db, user, payload)

    stored = save_document(
        "dealer-docs",
        dealer.id,
        _demo_pdf(),
        "application/pdf",
        "gst-certificate.pdf",
    )
    dealer = dealer_service.add_document(
        db,
        dealer,
        actor=user,
        doc_type="gst_certificate",
        stored_key=stored.key,
        file_name="gst-certificate.pdf",
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
    )

    db.expire_all()
    dealer = dealer_service.load_dealer(db, dealer.id)
    admin_service.approve_dealer(
        db, dealer, admin, reason="Demo seed approval.", http_request=None
    )
    dealer = dealer_service.load_dealer(db, dealer.id)
    dealer_service.update_availability(
        db,
        dealer,
        DealerAvailabilityUpdate(accepts_new_requests=True),
        actor=user,
    )
    # City-wide coverage is added in addition to the named localities so demo
    # requests in other Hyderabad localities always have at least one match.
    if not any(area.locality is None for area in dealer.service_areas):
        db.add(
            DealerServiceArea(
                dealer_id=dealer.id,
                city_id=city.id,
                locality=None,
                pincode_prefixes=[],
            )
        )
        db.commit()
    db.expire_all()
    return dealer_service.load_dealer(db, dealer.id)


def _attach_photo(db, request: ScrapRequest, customer: User, seed: int) -> None:
    stored = save_image("request-images", request.id, _demo_jpeg(seed))
    request.images.append(
        ScrapImage(
            request_id=request.id,
            uploaded_by=customer.id,
            object_key=stored.key,
            mime_type=stored.mime_type,
            size_bytes=stored.size_bytes,
            width=stored.width,
            height=stored.height,
            sort_order=0,
        )
    )
    db.commit()


def _offer(
    db,
    *,
    request: ScrapRequest,
    dealer: DealerProfile,
    rates: dict[str, str],
    valid_hours: int = 24,
) -> None:
    items = []
    for item in request.items:
        rate = rates[item.category_id]
        items.append(
            OfferItemIn(
                category_id=item.category_id,
                rate_per_kg=Decimal(rate),
                estimated_weight_kg=item.estimated_weight_kg or Decimal("1"),
            )
        )
    payload = OfferCreate(
        request_id=request.id,
        items=items,
        min_total_weight_kg=Decimal("0"),
        pickup_date=request.preferred_date,
        pickup_window=request.time_window,
        valid_until=utcnow() + timedelta(hours=valid_hours),
        conditions="Final weight measured digitally at pickup.",
        disclosure="Rates are locked for the accepted quote snapshot.",
    )
    try:
        offer_service.create_offer(
            db,
            dealer,
            payload,
            actor_id=dealer.user_id,
            http_request=None,
        )
    except Exception as exc:  # noqa: BLE001
        from app.services.matching import dealer_eligible_for_request

        print(
            "  [debug] offer failed for "
            f"{dealer.business_name} on {request.reference}: {exc}"
        )
        print("  [debug]", dealer_eligible_for_request(db, dealer, request))
        raise

def _rates(categories: dict[str, MaterialCategory], values: dict[str, str]) -> dict[str, str]:
    return {categories[slug].id: rate for slug, rate in values.items()}


def create_open_request(
    db,
    *,
    customer: User,
    address: CustomerAddress,
    categories: dict[str, MaterialCategory],
    day: date,
    window: str,
    materials: list[tuple[str, str]],
    dealers_and_rates: list[tuple[DealerProfile, dict[str, str]]],
    seed: int,
) -> ScrapRequest:
    payload = RequestCreate(
        address_id=address.id,
        preferred_date=day,
        time_window=window,
        customer_notes="Please call before arriving. Gate code 4421.",
        items=[
            RequestItemIn(
                category_id=categories[slug].id,
                estimated_weight_kg=Decimal(weight),
                quantity_unit="kg",
            )
            for slug, weight in materials
        ],
    )
    request = request_service.create_request(db, customer, payload)
    _attach_photo(db, request, customer, seed)
    request = request_service.submit_request(db, request, customer)
    for dealer, rates in dealers_and_rates:
        _offer(db, request=request, dealer=dealer, rates=_rates(categories, rates))
    return request_service.load_request(db, request.id)


def create_completed_booking(
    db,
    *,
    customer: User,
    address: CustomerAddress,
    categories: dict[str, MaterialCategory],
    dealer: DealerProfile,
    day: date,
    window: str,
    materials: list[tuple[str, str]],
    rates: dict[str, str],
) -> None:
    request = request_service.create_request(
        db,
        customer,
        RequestCreate(
            address_id=address.id,
            preferred_date=day,
            time_window=window,
            customer_notes="Old washing machine and newspaper bundle.",
            items=[
                RequestItemIn(
                    category_id=categories[slug].id,
                    estimated_weight_kg=Decimal(weight),
                    quantity_unit="kg",
                )
                for slug, weight in materials
            ],
        ),
    )
    _attach_photo(db, request, customer, 3)
    request = request_service.submit_request(db, request, customer)
    _offer(db, request=request, dealer=dealer, rates=_rates(categories, rates))

    offer = request.offers[0]
    booking = offer_service.accept_offer(db, offer_id=offer.id, customer_id=customer.id)
    booking_service.confirm_job(db, booking, dealer.user)
    booking_service.start_pickup(db, booking, dealer.user)

    accepted_items = [
        (categories[slug].id, Decimal(weight)) for slug, weight in materials
    ]
    booking_service.record_weighing(
        db,
        booking,
        dealer.user,
        RecordWeighingBody(
            items=[
                WeighingItemIn(category_id=category_id, actual_weight_kg=weight)
                for category_id, weight in accepted_items
            ],
            notes="Digital scale, tare weight deducted.",
        ),
    )
    booking = booking_service.load_booking(db, booking.id)
    booking_service.submit_settlement(
        db,
        booking,
        dealer.user,
        SubmitSettlementBody(
            items=[
                {
                    "category_id": category_id,
                    "actual_weight_kg": weight,
                }
                for category_id, weight in accepted_items
            ],
            deductions=Decimal("0"),
            notes="Agreed rate honoured.",
        ),
    )
    booking = booking_service.load_booking(db, booking.id)
    settlement = booking.settlements[0]
    booking_service.confirm_settlement(
        db, booking, customer, approve=True, note="Weights and rate match."
    )
    booking_service.record_payment(
        db,
        booking_service.load_booking(db, booking.id),
        dealer.user,
        method="upi",
        amount=settlement.final_payout,
        upi_reference=f"DEMO{booking.reference[-6:]}",
        payer_note="Demo UPI payment recorded outside the platform.",
    )
    booking = booking_service.load_booking(db, booking.id)
    payment = booking.payments[0]
    booking = booking_service.confirm_payment(db, booking, customer, payment.id)
    if booking.status != "completed":
        raise RuntimeError("Demo booking did not reach completed status.")

    try:
        engagement.create_review(
            db,
            customer,
            ReviewCreate(
                booking_id=booking.id,
                rating=5,
                comment="On time, digital weighing, and the payout matched the quote.",
            ),
        )
    except AppError as exc:  # pragma: no cover - demo only
        print(f"  [warn] review seed skipped: {exc.message}")
    _ok(f"completed booking {booking.reference} with confirmed payment and review")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def seed_demo() -> int:
    if not settings.allow_demo_seed:
        print("Demo seeding is disabled (ALLOW_DEMO_SEED=false).", file=sys.stderr)
        return 2
    if settings.is_production:
        print(
            "Refusing to seed demo data in production. "
            "Set ENVIRONMENT=development in a safe environment.",
            file=sys.stderr,
        )
        return 2

    print("Seeding ScrapSetu demo data (idempotent)…")
    db = SessionLocal()
    try:
        city = ensure_city(db)
        categories = ensure_catalogue(db, city)

        users: dict[str, User] = {}
        for phone, role, name, email in DEMO_USERS:
            users[phone] = ensure_user(db, phone, role, name, email)

        customer = users["+919000000001"]
        customer_two = users["+919000000002"]
        admin = users["+919000000999"]
        dealer_users = [
            users["+919000000101"],
            users["+919000000102"],
            users["+919000000103"],
        ]

        addresses = {
            "madhapur": ensure_address(
                db, customer, city, label="Home", locality="Madhapur",
                pincode="500081", line1="Flat 302, Cyber Heights",
            ),
            "gachibowli": ensure_address(
                db, customer_two, city, label="Home", locality="Gachibowli",
                pincode="500032", line1="Villa 8, Palm Meadows",
            ),
        }

        dealer1 = ensure_dealer(
            db, user=dealer_users[0], admin=admin, city=city, categories=categories,
            business_name="Kumar Scrap Traders", locality="Madhapur", min_kg="5",
            category_slugs=["iron", "aluminium", "copper", "brass", "paper"],
        )
        dealer2 = ensure_dealer(
            db, user=dealer_users[1], admin=admin, city=city, categories=categories,
            business_name="Meena Metal & Paper", locality="Gachibowli", min_kg="2",
            category_slugs=["iron", "aluminium", "paper", "plastic", "copper"],
        )
        dealer3 = ensure_dealer(
            db, user=dealer_users[2], admin=admin, city=city, categories=categories,
            business_name="GreenLoop E-Waste Recycling", locality="Kondapur", min_kg="1.5",
            category_slugs=[
                "e_waste", "battery", "iron", "aluminium", "plastic", "paper",
                "copper",
            ],
        )

        today = local_today()
        existing_open = db.execute(
            select(ScrapRequest).where(
                ScrapRequest.customer_id == customer.id,
                ScrapRequest.status == "open",
            )
        ).scalars().first()
        if not existing_open:
            request_a = create_open_request(
                db,
                customer=customer,
                address=addresses["madhapur"],
                categories=categories,
                day=today + timedelta(days=2),
                window="morning",
                materials=[("iron", "18"), ("copper", "2.5"), ("paper", "12")],
                dealers_and_rates=[
                    (dealer1, {
                        "iron": "27.50", "copper": "690.00", "paper": "13.00",
                    }),
                    (dealer2, {
                        "iron": "26.00", "copper": "705.00", "paper": "14.50",
                    }),
                    (dealer3, {
                        "iron": "25.00", "copper": "672.00", "paper": "12.00",
                    }),
                ],
                seed=0,
            )
            _ok(f"open request {request_a.reference} with 3 offers")

            request_b = create_open_request(
                db,
                customer=customer_two,
                address=addresses["gachibowli"],
                categories=categories,
                day=today + timedelta(days=3),
                window="midday",
                materials=[
                    ("e_waste", "14"), ("battery", "8"), ("plastic", "10"),
                ],
                dealers_and_rates=[
                    (dealer3, {
                        "e_waste": "88.00", "battery": "82.00", "plastic": "26.00",
                    }),
                ],
                seed=1,
            )
            _ok(f"open request {request_b.reference} with 1 offer")
        else:
            _skip("open demo requests already exist")

        completed_exists = db.execute(
            select(ScrapRequest).where(
                ScrapRequest.customer_id == customer.id,
                ScrapRequest.status == "completed",
            )
        ).scalars().first()
        if not completed_exists:
            create_completed_booking(
                db,
                customer=customer,
                address=addresses["madhapur"],
                categories=categories,
                dealer=dealer1,
                day=today + timedelta(days=4),
                window="afternoon",
                materials=[("iron", "22"), ("aluminium", "6")],
                rates={"iron": "28.00", "aluminium": "132.00"},
            )
        else:
            _skip("completed demo booking already exists")

        existing_ticket = db.execute(
            select(SupportTicket).where(
                SupportTicket.user_id == customer.id,
                SupportTicket.category == "general",
            )
        ).scalars().first()
        if not existing_ticket:
            try:
                engagement.create_support_ticket(
                    db,
                    customer,
                    SupportTicketCreate(
                        subject="Invoice copy for my completed pickup",
                        message=(
                            "Please share a PDF summary of my completed pickup for "
                            "my housing society records."
                        ),
                        category="general",
                    ),
                )
                _ok("open support ticket")
            except AppError as exc:  # pragma: no cover - demo only
                print(f"  [warn] support ticket seed skipped: {exc.message}")

        db.commit()
        print()
        print("Demo accounts (sign in with phone + dev OTP shown in the UI):")
        for phone, role, name, _email in DEMO_USERS:
            print(f"  {role:8s} {phone}  {name}")
        print()
        print(f"Demo data ready in {settings.database_dsn}")
        print("Run the API and open http://localhost:5173 to explore.")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"Seeding failed: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


def create_admin(phone: str, name: str | None, email: str | None) -> int:
    db = SessionLocal()
    try:
        phone = normalize_indian_phone(phone)
        existing = db.execute(select(User).where(User.phone == phone)).scalar_one_or_none()
        if existing:
            if existing.role != Role.ADMIN:
                print(
                    f"{phone} already exists with role {existing.role}. "
                    "Use a different phone for the administrator.",
                    file=sys.stderr,
                )
                return 1
            print(f"Administrator {phone} already exists.")
            return 0
        ensure_user(db, phone, Role.ADMIN, name or "ScrapSetu Admin", email)
        print(
            f"Administrator created: {phone}. Sign in with phone OTP; "
            "there is no password to share."
        )
        return 0
    finally:
        db.close()


def expire_sweep() -> int:
    db = SessionLocal()
    try:
        requests_expired = request_service.expire_stale_requests(db)
        offers_expired = offer_service.expire_stale_offers(db)
        print(
            f"Swept {requests_expired} expired listing(s) and "
            f"{offers_expired} expired offer(s)."
        )
        return 0
    finally:
        db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("seed-demo", help="Create idempotent demo catalogue, users and bookings")

    admin_parser = sub.add_parser("create-admin", help="Create an administrator account")
    admin_parser.add_argument("--phone", required=True, help="E.164 or 10-digit Indian phone")
    admin_parser.add_argument("--name", default=None, help="Display name")
    admin_parser.add_argument("--email", default=None, help="Optional email")

    sub.add_parser("expire-sweep", help="Expire stale listings and offers")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "seed-demo":
        return seed_demo()
    if args.command == "create-admin":
        return create_admin(args.phone, args.name, args.email)
    if args.command == "expire-sweep":
        return expire_sweep()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

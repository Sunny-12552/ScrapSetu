"""SQLAlchemy models for ScrapSetu.

Conventions
-----------
* UUID strings as primary keys (portable across PostgreSQL/SQLite).
* Money: ``Numeric(14, 2)`` (INR). Weights: ``Numeric(12, 3)`` in kilograms.
* All timestamps are stored in UTC via :class:`UTCDateTime`.
* Status columns are strings validated by application enums so migrations stay
  simple; allowed values live in ``app.models.enums``.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MONEY, PERCENT, RATE, UTCDateTime, WEIGHT, Base, TimestampMixin
from app.core.time import utcnow


def _uuid() -> str:
    return str(uuid4())


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class Role(StrEnum):
    CUSTOMER = "customer"
    DEALER = "dealer"
    ADMIN = "admin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class Locale(StrEnum):
    EN = "en"
    HI = "hi"
    TE = "te"


class DealerStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    SUSPENDED = "suspended"


class DocumentStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class RequestStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    OFFER_SELECTED = "offer_selected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class OfferStatus(StrEnum):
    SUBMITTED = "submitted"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"
    ACCEPTED = "accepted"
    NOT_SELECTED = "not_selected"
    SUPERSEDED = "superseded"


class BookingStatus(StrEnum):
    OFFER_SELECTED = "offer_selected"
    BOOKING_CONFIRMED = "booking_confirmed"
    PICKUP_IN_PROGRESS = "pickup_in_progress"
    WEIGHING_RECORDED = "weighing_recorded"
    SETTLEMENT_PENDING = "settlement_pending"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DISPUTED = "disputed"
    FAILED = "failed"


class SettlementStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    CUSTOMER_CONFIRMED = "customer_confirmed"
    DISPUTED = "disputed"
    PAID = "paid"
    COMPLETED = "completed"
    VOID = "void"


class PaymentMethod(StrEnum):
    CASH = "cash"
    UPI = "upi"


class PaymentStatus(StrEnum):
    PENDING = "pending"
    RECORDED = "recorded"  # dealer says paid, awaiting customer confirmation
    CONFIRMED = "confirmed"  # customer confirmed receipt
    FAILED = "failed"
    DISPUTED = "disputed"


class DisputeStatus(StrEnum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    RESOLVED = "resolved"
    WITHDRAWN = "withdrawn"


class ReviewStatus(StrEnum):
    PUBLISHED = "published"
    HIDDEN = "hidden"
    FLAGGED = "flagged"


class NotificationChannel(StrEnum):
    IN_APP = "in_app"
    SMS = "sms"
    EMAIL = "email"


class TicketStatus(StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


class FeeType(StrEnum):
    PERCENT = "percent"
    FLAT = "flat"


class FeeAppliesTo(StrEnum):
    CUSTOMER = "customer"
    DEALER = "dealer"


# ---------------------------------------------------------------------------
# Users and authentication
# ---------------------------------------------------------------------------


class City(Base, TimestampMixin):
    __tablename__ = "cities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    center_lat: Mapped[Decimal | None] = mapped_column(RATE, nullable=True)
    center_lng: Mapped[Decimal | None] = mapped_column(RATE, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    phone: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(16), default=UserStatus.ACTIVE, nullable=False, index=True
    )
    phone_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    suspension_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    locale: Mapped[str] = mapped_column(String(8), default=Locale.EN, nullable=False)

    profile: Mapped[UserProfile | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    dealer_profile: Mapped[DealerProfile | None] = relationship(
        back_populates="user", uselist=False
    )

    __table_args__ = (
        CheckConstraint("role in ('customer','dealer','admin')", name="role_valid"),
        CheckConstraint("status in ('active','suspended','deleted')", name="status_valid"),
    )


class UserProfile(Base, TimestampMixin):
    __tablename__ = "user_profiles"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    full_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    avatar_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preferred_language: Mapped[str] = mapped_column(
        String(8), default=Locale.EN, nullable=False
    )

    user: Mapped[User] = relationship(back_populates="profile")


class OtpChallenge(Base, TimestampMixin):
    __tablename__ = "otp_challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    phone: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), default="login", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    resend_available_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    request_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (Index("ix_otp_phone_created", "phone", "created_at"),)


class AuthSession(Base, TimestampMixin):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    refresh_token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    replaced_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    user: Mapped[User] = relationship()


class CustomerAddress(Base, TimestampMixin):
    __tablename__ = "customer_addresses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    customer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(40), default="Home", nullable=False)
    contact_name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact_phone: Mapped[str] = mapped_column(String(16), nullable=False)
    line1: Mapped[str] = mapped_column(String(255), nullable=False)
    line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locality: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    city_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("cities.id"), nullable=False, index=True
    )
    postal_code: Mapped[str] = mapped_column(String(6), nullable=False, index=True)
    latitude: Mapped[Decimal | None] = mapped_column(RATE, nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(RATE, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    city: Mapped[City] = relationship()

    __table_args__ = (Index("ix_address_customer_active", "customer_id", "is_active"),)


# ---------------------------------------------------------------------------
# Dealers
# ---------------------------------------------------------------------------


class DealerProfile(Base, TimestampMixin):
    __tablename__ = "dealer_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    business_name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    contact_person: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True)
    address_line: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("cities.id"), nullable=False, index=True
    )
    locality: Mapped[str | None] = mapped_column(String(160), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default=DealerStatus.DRAFT, nullable=False, index=True
    )
    min_collection_kg: Mapped[Decimal] = mapped_column(
        WEIGHT, default=Decimal("5"), nullable=False
    )
    accepts_new_requests: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    operating_hours: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    verification_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    verified_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    suspended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    suspension_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating_avg: Mapped[Decimal] = mapped_column(
        RATE, default=Decimal("0"), nullable=False
    )
    rating_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_jobs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cancelled_jobs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped[User] = relationship(back_populates="dealer_profile")
    city: Mapped[City] = relationship()
    service_areas: Mapped[list[DealerServiceArea]] = relationship(
        back_populates="dealer", cascade="all, delete-orphan"
    )
    documents: Mapped[list[DealerVerificationDocument]] = relationship(
        back_populates="dealer", cascade="all, delete-orphan"
    )
    categories: Mapped[list[DealerCategory]] = relationship(
        back_populates="dealer", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status in ('draft','submitted','approved','rejected','suspended')",
            name="status_valid",
        ),
        CheckConstraint("min_collection_kg >= 0", name="min_collection_non_negative"),
        Index("ix_dealer_status_city", "status", "city_id"),
    )


class DealerVerificationDocument(Base, TimestampMixin):
    __tablename__ = "dealer_verification_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dealer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("dealer_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    doc_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_key: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default=DocumentStatus.PENDING, nullable=False
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    dealer: Mapped[DealerProfile] = relationship(back_populates="documents")


class DealerServiceArea(Base, TimestampMixin):
    __tablename__ = "dealer_service_areas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dealer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("dealer_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    city_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("cities.id"), nullable=False, index=True
    )
    locality: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    pincode_prefixes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    dealer: Mapped[DealerProfile] = relationship(back_populates="service_areas")
    city: Mapped[City] = relationship()

    __table_args__ = (
        UniqueConstraint("dealer_id", "city_id", "locality", name="uq_dealer_area"),
    )


class DealerCategory(Base, TimestampMixin):
    __tablename__ = "dealer_categories"

    dealer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("dealer_profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    category_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("material_categories.id"), primary_key=True
    )

    dealer: Mapped[DealerProfile] = relationship(back_populates="categories")
    category: Mapped[MaterialCategory] = relationship()


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


class MaterialCategory(Base, TimestampMixin):
    __tablename__ = "material_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(16), default="kg", nullable=False)
    icon: Mapped[str] = mapped_column(String(40), default="recycle", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    requires_special_handling: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (CheckConstraint("unit in ('kg','piece')", name="unit_valid"),)


class MaterialPriceReference(Base, TimestampMixin):
    __tablename__ = "material_price_references"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    category_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("material_categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    city_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("cities.id"), nullable=True, index=True
    )
    indicative_min_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    indicative_max_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

    category: Mapped[MaterialCategory] = relationship()

    __table_args__ = (
        CheckConstraint("indicative_min_rate >= 0", name="min_rate_non_negative"),
        CheckConstraint(
            "indicative_max_rate >= indicative_min_rate", name="rate_range_valid"
        ),
        Index("ix_price_ref_cat_city_effective", "category_id", "city_id", "effective_from"),
    )


# ---------------------------------------------------------------------------
# Scrap requests
# ---------------------------------------------------------------------------


class ScrapRequest(Base, TimestampMixin):
    __tablename__ = "scrap_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    reference: Mapped[str] = mapped_column(
        String(24), unique=True, nullable=False, index=True
    )
    customer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    address_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("customer_addresses.id", ondelete="SET NULL"), nullable=True
    )
    city_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("cities.id"), nullable=False, index=True
    )
    locality: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    postal_code: Mapped[str] = mapped_column(String(6), nullable=False, index=True)
    # Address snapshot is only revealed to the assigned dealer.
    address_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    preferred_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    time_window: Mapped[str] = mapped_column(String(32), nullable=False)
    contact_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(24), default=RequestStatus.DRAFT, nullable=False, index=True
    )
    estimated_total_weight_kg: Mapped[Decimal | None] = mapped_column(WEIGHT, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    offer_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    customer: Mapped[User] = relationship(foreign_keys=[customer_id])
    address: Mapped[CustomerAddress | None] = relationship()
    city: Mapped[City] = relationship()
    items: Mapped[list[ScrapRequestItem]] = relationship(
        back_populates="request", cascade="all, delete-orphan"
    )
    images: Mapped[list[ScrapImage]] = relationship(
        back_populates="request", cascade="all, delete-orphan"
    )
    offers: Mapped[list[DealerOffer]] = relationship(back_populates="request")
    booking: Mapped[Booking | None] = relationship(back_populates="request", uselist=False)

    __table_args__ = (
        CheckConstraint(
            "status in ('draft','open','offer_selected','expired','cancelled','completed')",
            name="status_valid",
        ),
        Index("ix_request_status_city_created", "status", "city_id", "created_at"),
        Index("ix_request_customer_status", "customer_id", "status"),
    )


class ScrapRequestItem(Base, TimestampMixin):
    __tablename__ = "scrap_request_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("scrap_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("material_categories.id"), nullable=False
    )
    estimated_weight_kg: Mapped[Decimal | None] = mapped_column(WEIGHT, nullable=True)
    estimated_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_unit: Mapped[str] = mapped_column(String(16), default="kg", nullable=False)
    condition_notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

    request: Mapped[ScrapRequest] = relationship(back_populates="items")
    category: Mapped[MaterialCategory] = relationship()

    __table_args__ = (
        UniqueConstraint("request_id", "category_id", name="uq_request_item_category"),
        CheckConstraint(
            "estimated_weight_kg is null or estimated_weight_kg >= 0",
            name="estimated_weight_non_negative",
        ),
        CheckConstraint(
            "estimated_quantity is null or estimated_quantity > 0",
            name="estimated_quantity_positive",
        ),
    )


class ScrapImage(Base, TimestampMixin):
    __tablename__ = "scrap_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("scrap_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    object_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    request: Mapped[ScrapRequest] = relationship(back_populates="images")

    __table_args__ = (Index("ix_image_request_active", "request_id", "deleted_at"),)


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------


class DealerOffer(Base, TimestampMixin):
    __tablename__ = "dealer_offers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("scrap_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dealer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("dealer_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default=OfferStatus.SUBMITTED, nullable=False, index=True
    )
    estimated_payout: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    min_total_weight_kg: Mapped[Decimal] = mapped_column(
        WEIGHT, default=Decimal("0"), nullable=False
    )
    pickup_date: Mapped[date] = mapped_column(Date, nullable=False)
    pickup_window: Mapped[str] = mapped_column(String(32), nullable=False)
    valid_until: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    disclosure: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )
    withdrawn_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    superseded_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    request: Mapped[ScrapRequest] = relationship(back_populates="offers")
    dealer: Mapped[DealerProfile] = relationship()
    items: Mapped[list[DealerOfferItem]] = relationship(
        back_populates="offer", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("request_id", "dealer_id", "version", name="uq_offer_version"),
        CheckConstraint("estimated_payout >= 0", name="payout_non_negative"),
        CheckConstraint("min_total_weight_kg >= 0", name="min_weight_non_negative"),
        CheckConstraint(
            "status in ('submitted','withdrawn','expired','accepted','not_selected','superseded')",
            name="status_valid",
        ),
        Index("uq_offer_one_accepted", "request_id", unique=True,
              sqlite_where=text("status = 'accepted'"),
              postgresql_where=text("status = 'accepted'")),
        Index("ix_offer_request_status", "request_id", "status"),
    )


class DealerOfferItem(Base, TimestampMixin):
    __tablename__ = "dealer_offer_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    offer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("dealer_offers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("material_categories.id"), nullable=False
    )
    rate_per_kg: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    estimated_weight_kg: Mapped[Decimal] = mapped_column(WEIGHT, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

    offer: Mapped[DealerOffer] = relationship(back_populates="items")
    category: Mapped[MaterialCategory] = relationship()

    __table_args__ = (
        UniqueConstraint("offer_id", "category_id", name="uq_offer_item_category"),
        CheckConstraint("rate_per_kg >= 0", name="rate_non_negative"),
        CheckConstraint("estimated_weight_kg > 0", name="estimated_weight_positive"),
        CheckConstraint("line_total >= 0", name="line_total_non_negative"),
    )


class OfferAcceptanceSnapshot(Base):
    """Immutable commercial terms captured at acceptance time."""

    __tablename__ = "offer_acceptance_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    dealer_id: Mapped[str] = mapped_column(String(36), nullable=False)
    offer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    offer_version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    accepted_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )


# ---------------------------------------------------------------------------
# Booking lifecycle
# ---------------------------------------------------------------------------


class Booking(Base, TimestampMixin):
    __tablename__ = "bookings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    reference: Mapped[str] = mapped_column(
        String(24), unique=True, nullable=False, index=True
    )
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("scrap_requests.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    dealer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("dealer_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    offer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dealer_offers.id", ondelete="RESTRICT"), nullable=False
    )
    snapshot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("offer_acceptance_snapshots.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default=BookingStatus.OFFER_SELECTED, nullable=False, index=True
    )
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    time_window: Mapped[str] = mapped_column(String(32), nullable=False)
    accepted_payout: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    pickup_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    weighing_recorded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    settlement_submitted_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    cancelled_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    request: Mapped[ScrapRequest] = relationship(back_populates="booking")
    customer: Mapped[User] = relationship(foreign_keys=[customer_id])
    dealer: Mapped[DealerProfile] = relationship()
    offer: Mapped[DealerOffer] = relationship()
    snapshot: Mapped[OfferAcceptanceSnapshot] = relationship()
    history: Mapped[list[BookingStatusHistory]] = relationship(
        back_populates="booking", order_by="BookingStatusHistory.created_at"
    )
    pickups: Mapped[list[PickupRecord]] = relationship(back_populates="booking")
    measured_items: Mapped[list[MeasuredScrapItem]] = relationship(
        back_populates="booking", cascade="all, delete-orphan"
    )
    settlements: Mapped[list[Settlement]] = relationship(
        back_populates="booking", order_by="Settlement.version"
    )
    payments: Mapped[list[PaymentRecord]] = relationship(
        back_populates="booking", order_by="PaymentRecord.created_at"
    )
    review: Mapped[Review | None] = relationship(back_populates="booking", uselist=False)
    disputes: Mapped[list[Dispute]] = relationship(back_populates="booking")

    __table_args__ = (
        CheckConstraint("accepted_payout >= 0", name="payout_non_negative"),
        CheckConstraint(
            "status in ('offer_selected','booking_confirmed','pickup_in_progress',"
            "'weighing_recorded','settlement_pending','completed','cancelled',"
            "'disputed','failed')",
            name="status_valid",
        ),
        Index("ix_booking_dealer_status", "dealer_id", "status"),
        Index("ix_booking_customer_status", "customer_id", "status"),
        Index("ix_booking_schedule", "scheduled_date", "status"),
        # One live booking per request; cancelled/failed bookings allow reassignment.
        Index(
            "uq_booking_active_request",
            "request_id",
            unique=True,
            sqlite_where=text("status not in ('cancelled','failed')"),
            postgresql_where=text("status not in ('cancelled','failed')"),
        ),
    )


class BookingStatusHistory(Base):
    __tablename__ = "booking_status_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_role: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )

    booking: Mapped[Booking] = relationship(back_populates="history")


class PickupRecord(Base, TimestampMixin):
    __tablename__ = "pickup_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dealer_id: Mapped[str] = mapped_column(String(36), nullable=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    booking: Mapped[Booking] = relationship(back_populates="pickups")


class BookingEvidence(Base):
    """Dealer/customer evidence attached to a booking (weighing, payment, other)."""

    __tablename__ = "booking_evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    evidence_type: Mapped[str] = mapped_column(String(24), nullable=False)
    file_key: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )


class MeasuredScrapItem(Base, TimestampMixin):
    __tablename__ = "measured_scrap_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("material_categories.id"), nullable=False
    )
    actual_weight_kg: Mapped[Decimal] = mapped_column(WEIGHT, nullable=False)
    rate_per_kg: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    recorded_by: Mapped[str] = mapped_column(String(36), nullable=False)

    booking: Mapped[Booking] = relationship(back_populates="measured_items")
    category: Mapped[MaterialCategory] = relationship()

    __table_args__ = (
        UniqueConstraint("booking_id", "category_id", name="uq_measured_category"),
        CheckConstraint("actual_weight_kg >= 0", name="weight_non_negative"),
        CheckConstraint("rate_per_kg >= 0", name="rate_non_negative"),
    )


# ---------------------------------------------------------------------------
# Settlement and payments
# ---------------------------------------------------------------------------


class Settlement(Base, TimestampMixin):
    __tablename__ = "settlements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    snapshot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), default=SettlementStatus.DRAFT, nullable=False, index=True
    )
    gross_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    deductions: Mapped[Decimal] = mapped_column(
        MONEY, default=Decimal("0"), nullable=False
    )
    adjustments: Mapped[Decimal] = mapped_column(
        MONEY, default=Decimal("0"), nullable=False
    )
    platform_fee: Mapped[Decimal] = mapped_column(
        MONEY, default=Decimal("0"), nullable=False
    )
    final_payout: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    deduction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    calculation: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    submitted_by: Mapped[str] = mapped_column(String(36), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )
    customer_confirmed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    disputed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    admin_adjusted_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    admin_adjustment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    booking: Mapped[Booking] = relationship(back_populates="settlements")
    items: Mapped[list[SettlementItem]] = relationship(
        back_populates="settlement", cascade="all, delete-orphan"
    )
    payments: Mapped[list[PaymentRecord]] = relationship(back_populates="settlement")

    __table_args__ = (
        UniqueConstraint("booking_id", "version", name="uq_settlement_version"),
        CheckConstraint("final_payout >= 0", name="final_payout_non_negative"),
        CheckConstraint("gross_amount >= 0", name="gross_non_negative"),
    )


class SettlementItem(Base):
    __tablename__ = "settlement_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    settlement_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("settlements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("material_categories.id"), nullable=False
    )
    actual_weight_kg: Mapped[Decimal] = mapped_column(WEIGHT, nullable=False)
    accepted_rate_per_kg: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    final_rate_per_kg: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    rate_changed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_consent_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    customer_consent: Mapped[str | None] = mapped_column(String(16), nullable=True)

    settlement: Mapped[Settlement] = relationship(back_populates="items")
    category: Mapped[MaterialCategory] = relationship()


class PaymentRecord(Base, TimestampMixin):
    __tablename__ = "payment_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    settlement_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("settlements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default=PaymentStatus.PENDING, nullable=False, index=True
    )
    upi_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    payer_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recorded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )
    customer_confirmed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    booking: Mapped[Booking] = relationship(back_populates="payments")
    settlement: Mapped[Settlement] = relationship(back_populates="payments")
    events: Mapped[list[PaymentEvent]] = relationship(
        back_populates="payment", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("method in ('cash','upi')", name="method_valid"),
        CheckConstraint(
            "status in ('pending','recorded','confirmed','failed','disputed')",
            name="status_valid",
        ),
        CheckConstraint("amount >= 0", name="amount_non_negative"),
    )


class PaymentEvent(Base):
    __tablename__ = "payment_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    payment_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("payment_records.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(120), unique=True, nullable=True
    )
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )

    payment: Mapped[PaymentRecord] = relationship(back_populates="events")


# ---------------------------------------------------------------------------
# Reviews, disputes, support, notifications
# ---------------------------------------------------------------------------


class Review(Base, TimestampMixin):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    dealer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default=ReviewStatus.PUBLISHED, nullable=False, index=True
    )
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    moderated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    moderated_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    booking: Mapped[Booking] = relationship(back_populates="review")

    __table_args__ = (
        CheckConstraint("rating between 1 and 5", name="rating_range"),
        CheckConstraint(
            "status in ('published','hidden','flagged')", name="status_valid"
        ),
    )


class Dispute(Base, TimestampMixin):
    __tablename__ = "disputes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    booking_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    settlement_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    raised_by: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    raised_by_role: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default=DisputeStatus.OPEN, nullable=False, index=True
    )
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    booking: Mapped[Booking] = relationship(back_populates="disputes")
    evidence: Mapped[list[DisputeEvidence]] = relationship(
        back_populates="dispute", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "category in ('weight','material_quality','payment','conduct','other')",
            name="category_valid",
        ),
        CheckConstraint(
            "status in ('open','under_review','resolved','withdrawn')",
            name="status_valid",
        ),
    )


class DisputeEvidence(Base):
    __tablename__ = "dispute_evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dispute_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("disputes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    file_key: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )

    dispute: Mapped[Dispute] = relationship(back_populates="evidence")


class SupportTicket(Base, TimestampMixin):
    __tablename__ = "support_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    reference: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(40), default="general", nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default=TicketStatus.OPEN, nullable=False, index=True
    )
    priority: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    assigned_to: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)


class UserReport(Base, TimestampMixin):
    __tablename__ = "user_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    reporter_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    reported_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(
        String(120), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False, index=True
    )

    deliveries: Mapped[list[NotificationDelivery]] = relationship(
        back_populates="notification", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_notification_user_read", "user_id", "is_read"),)


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    notification_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )

    notification: Mapped[Notification] = relationship(back_populates="deliveries")


# ---------------------------------------------------------------------------
# Administration
# ---------------------------------------------------------------------------


class PlatformFeeRule(Base, TimestampMixin):
    __tablename__ = "platform_fee_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    fee_type: Mapped[str] = mapped_column(String(16), default=FeeType.PERCENT, nullable=False)
    value: Mapped[Decimal] = mapped_column(PERCENT, nullable=False)
    applies_to: Mapped[str] = mapped_column(
        String(16), default=FeeAppliesTo.CUSTOMER, nullable=False
    )
    city_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

    __table_args__ = (
        CheckConstraint("fee_type in ('percent','flat')", name="fee_type_valid"),
        CheckConstraint("value >= 0", name="value_non_negative"),
        CheckConstraint("applies_to in ('customer','dealer')", name="applies_valid"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False, index=True
    )


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(160), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "key", "endpoint", name="uq_idempotency_scope"),
        Index("ix_idempotency_created", "created_at"),
    )


__all__ = [
    "Role", "UserStatus", "Locale", "DealerStatus", "DocumentStatus", "RequestStatus",
    "OfferStatus", "BookingStatus", "SettlementStatus", "PaymentMethod", "PaymentStatus",
    "DisputeStatus", "ReviewStatus", "NotificationChannel", "TicketStatus", "FeeType",
    "FeeAppliesTo", "City", "User", "UserProfile", "OtpChallenge", "AuthSession",
    "CustomerAddress", "DealerProfile", "DealerVerificationDocument", "DealerServiceArea",
    "DealerCategory", "MaterialCategory", "MaterialPriceReference", "ScrapRequest",
    "ScrapRequestItem", "ScrapImage", "DealerOffer", "DealerOfferItem",
    "OfferAcceptanceSnapshot", "Booking", "BookingStatusHistory", "PickupRecord",
    "BookingEvidence", "MeasuredScrapItem", "Settlement", "SettlementItem", "PaymentRecord", "PaymentEvent",
    "Review", "Dispute", "DisputeEvidence", "SupportTicket", "UserReport", "Notification",
    "NotificationDelivery", "PlatformFeeRule", "AuditLog", "IdempotencyKey",
]

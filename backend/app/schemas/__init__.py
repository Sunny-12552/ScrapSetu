"""Pydantic request/response models for the v1 API."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Generic, Literal, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.core.constants import MAX_QUANTITY_KG, MAX_RATE_PER_KG, TIME_WINDOWS
from app.core.security import normalize_indian_phone

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(BaseModel):
    message: str


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class OtpRequestBody(BaseModel):
    phone: str
    role: Literal["customer", "dealer", "admin"] = "customer"
    purpose: Literal["login", "signup"] = "login"

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        try:
            return normalize_indian_phone(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


class OtpRequestResponse(BaseModel):
    phone_masked: str
    expires_in_seconds: int
    resend_after_seconds: int
    delivered_via: str
    dev_otp: str | None = None
    message: str


class OtpVerifyBody(BaseModel):
    phone: str
    code: str = Field(min_length=4, max_length=8)
    role: Literal["customer", "dealer", "admin"] = "customer"
    full_name: str | None = Field(default=None, max_length=160)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        try:
            return normalize_indian_phone(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("Enter the numeric OTP.")
        return value


class UserBrief(ORMModel):
    id: str
    role: str
    phone_masked: str
    name: str | None = None
    status: str
    locale: str = "en"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserBrief
    is_new_user: bool = False


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserBrief


class MeResponse(BaseModel):
    user: UserBrief
    profile: "ProfileRead"
    dealer: "DealerSummary | None" = None
    unread_notifications: int = 0


# ---------------------------------------------------------------------------
# Profile & addresses
# ---------------------------------------------------------------------------


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=160)
    email: EmailStr | None = None
    locale: Literal["en", "hi", "te"] | None = None
    preferred_language: Literal["en", "hi", "te"] | None = None


class ProfileRead(ORMModel):
    user_id: str
    full_name: str | None = None
    email: str | None = None
    preferred_language: str = "en"


class CityRead(ORMModel):
    id: str
    name: str
    state: str
    slug: str
    is_active: bool


class AddressCreate(BaseModel):
    label: str = Field(default="Home", max_length=40)
    contact_name: str = Field(min_length=2, max_length=160)
    contact_phone: str | None = None
    line1: str = Field(min_length=5, max_length=255)
    line2: str | None = Field(default=None, max_length=255)
    locality: str = Field(min_length=2, max_length=160)
    city_id: str
    postal_code: str = Field(pattern=r"^[1-9][0-9]{5}$")
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    is_default: bool = False

    @field_validator("contact_phone")
    @classmethod
    def _contact_phone(cls, value: str | None) -> str | None:
        if value in (None, ""):
            return None
        try:
            return normalize_indian_phone(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


class AddressUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=40)
    contact_name: str | None = Field(default=None, min_length=2, max_length=160)
    contact_phone: str | None = None
    line1: str | None = Field(default=None, min_length=5, max_length=255)
    line2: str | None = Field(default=None, max_length=255)
    locality: str | None = Field(default=None, min_length=2, max_length=160)
    city_id: str | None = None
    postal_code: str | None = Field(default=None, pattern=r"^[1-9][0-9]{5}$")
    is_default: bool | None = None


class AddressRead(ORMModel):
    id: str
    label: str
    contact_name: str
    contact_phone: str
    line1: str
    line2: str | None = None
    locality: str
    postal_code: str
    city_id: str
    city_name: str | None = None
    is_default: bool
    is_active: bool
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


class CategoryRead(ORMModel):
    id: str
    slug: str
    name: str
    description: str | None = None
    unit: str
    icon: str
    is_active: bool
    requires_special_handling: bool
    sort_order: int = 0
    indicative_min_rate: Decimal | None = None
    indicative_max_rate: Decimal | None = None


class PriceReferenceCreate(BaseModel):
    category_id: str
    city_id: str | None = None
    indicative_min_rate: Decimal = Field(ge=0, le=MAX_RATE_PER_KG)
    indicative_max_rate: Decimal = Field(ge=0, le=MAX_RATE_PER_KG)
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def _range(self) -> "PriceReferenceCreate":
        if self.indicative_max_rate < self.indicative_min_rate:
            raise ValueError("Maximum rate cannot be below the minimum rate.")
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("End date cannot be before the start date.")
        return self


class PriceReferenceRead(ORMModel):
    id: str
    category_id: str
    category_name: str | None = None
    city_id: str | None = None
    indicative_min_rate: Decimal
    indicative_max_rate: Decimal
    effective_from: date
    effective_to: date | None = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Scrap requests
# ---------------------------------------------------------------------------


class RequestItemIn(BaseModel):
    category_id: str
    estimated_weight_kg: Decimal | None = Field(default=None, ge=0, le=MAX_QUANTITY_KG)
    estimated_quantity: int | None = Field(default=None, ge=1, le=100000)
    quantity_unit: Literal["kg", "piece"] = "kg"
    condition_notes: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _has_estimate(self) -> "RequestItemIn":
        if not self.estimated_weight_kg and not self.estimated_quantity:
            raise ValueError(
                "Provide an approximate weight or item count for this material."
            )
        if self.quantity_unit == "kg" and self.estimated_weight_kg is None and self.estimated_quantity:
            # Allow item count only when unit is piece; otherwise ask for weight.
            raise ValueError(
                "Enter the approximate weight in kg for this material, or switch to piece count."
            )
        return self


class RequestCreate(BaseModel):
    address_id: str
    preferred_date: date
    time_window: Literal["morning", "midday", "afternoon", "evening"]
    customer_notes: str | None = Field(default=None, max_length=1000)
    items: list[RequestItemIn] = Field(min_length=1, max_length=12)

    @field_validator("items")
    @classmethod
    def _unique_categories(cls, value: list[RequestItemIn]) -> list[RequestItemIn]:
        ids = [i.category_id for i in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Each material can appear only once.")
        return value


class RequestUpdate(BaseModel):
    preferred_date: date | None = None
    time_window: Literal["morning", "midday", "afternoon", "evening"] | None = None
    customer_notes: str | None = Field(default=None, max_length=1000)
    items: list[RequestItemIn] | None = Field(default=None, min_length=1, max_length=12)


class RequestItemRead(ORMModel):
    id: str
    category_id: str
    category_name: str | None = None
    category_slug: str | None = None
    estimated_weight_kg: Decimal | None = None
    estimated_quantity: int | None = None
    quantity_unit: str
    condition_notes: str | None = None


class ImageRead(BaseModel):
    id: str
    url: str
    width: int | None = None
    height: int | None = None
    size_bytes: int
    mime_type: str


class RequestRead(ORMModel):
    id: str
    reference: str
    status: str
    city_id: str
    locality: str
    postal_code: str
    preferred_date: date
    time_window: str
    estimated_total_weight_kg: Decimal | None = None
    customer_notes: str | None = None
    offer_count: int = 0
    items: list[RequestItemRead] = []
    images: list[ImageRead] = []
    created_at: datetime
    published_at: datetime | None = None
    expires_at: datetime | None = None
    booking_id: str | None = None
    accepted_offer_id: str | None = None


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------


class OfferItemIn(BaseModel):
    category_id: str
    rate_per_kg: Decimal = Field(ge=0, le=MAX_RATE_PER_KG)
    estimated_weight_kg: Decimal = Field(gt=0, le=MAX_QUANTITY_KG)
    notes: str | None = Field(default=None, max_length=255)


class OfferCreate(BaseModel):
    request_id: str
    items: list[OfferItemIn] = Field(min_length=1, max_length=12)
    min_total_weight_kg: Decimal = Field(default=Decimal("0"), ge=0, le=MAX_QUANTITY_KG)
    pickup_date: date
    pickup_window: Literal["morning", "midday", "afternoon", "evening"]
    valid_until: datetime
    conditions: str | None = Field(default=None, max_length=1000)
    disclosure: str | None = Field(default=None, max_length=1000)

    @field_validator("items")
    @classmethod
    def _unique(cls, value: list[OfferItemIn]) -> list[OfferItemIn]:
        ids = [i.category_id for i in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Each material can appear only once.")
        return value


class OfferUpdate(BaseModel):
    items: list[OfferItemIn] | None = Field(default=None, min_length=1, max_length=12)
    min_total_weight_kg: Decimal | None = Field(default=None, ge=0, le=MAX_QUANTITY_KG)
    pickup_date: date | None = None
    pickup_window: Literal["morning", "midday", "afternoon", "evening"] | None = None
    valid_until: datetime | None = None
    conditions: str | None = Field(default=None, max_length=1000)
    disclosure: str | None = Field(default=None, max_length=1000)


class DealerPublic(ORMModel):
    id: str
    business_name: str
    locality: str | None = None
    city_name: str | None = None
    verified: bool = False
    status: str = "approved"
    rating_avg: Decimal = Decimal("0")
    rating_count: int = 0
    completed_jobs: int = 0
    min_collection_kg: Decimal = Decimal("0")
    description: str | None = None
    # Contact number is only populated on booking payloads for the customer and
    # admin who are party to the job; public dealer listings never include it.
    phone: str | None = None


class OfferItemRead(ORMModel):
    id: str
    category_id: str
    category_name: str | None = None
    rate_per_kg: Decimal
    estimated_weight_kg: Decimal
    line_total: Decimal
    notes: str | None = None


class OfferRead(ORMModel):
    id: str
    request_id: str
    version: int
    status: str
    estimated_payout: Decimal
    min_total_weight_kg: Decimal
    pickup_date: date
    pickup_window: str
    valid_until: datetime
    conditions: str | None = None
    disclosure: str | None = None
    created_at: datetime
    dealer: DealerPublic
    items: list[OfferItemRead] = []
    is_expired: bool = False
    is_selectable: bool = True


# ---------------------------------------------------------------------------
# Dealer
# ---------------------------------------------------------------------------


class DealerApplication(BaseModel):
    business_name: str = Field(min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    contact_person: str = Field(min_length=2, max_length=160)
    email: EmailStr | None = None
    gstin: str | None = Field(default=None, pattern=r"^[0-9A-Z]{15}$")
    pan: str | None = Field(default=None, pattern=r"^[A-Z]{5}[0-9]{4}[A-Z]$")
    address_line: str | None = Field(default=None, max_length=255)
    city_id: str
    locality: str | None = Field(default=None, max_length=160)
    postal_code: str | None = Field(default=None, pattern=r"^[1-9][0-9]{5}$")
    description: str | None = Field(default=None, max_length=1000)
    min_collection_kg: Decimal = Field(default=Decimal("5"), ge=0, le=MAX_QUANTITY_KG)
    category_ids: list[str] = Field(min_length=1)
    service_areas: list[str] = Field(default_factory=list)


class DealerServiceAreaIn(BaseModel):
    city_id: str
    locality: str | None = Field(default=None, max_length=160)
    pincode_prefixes: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("pincode_prefixes")
    @classmethod
    def _prefixes(cls, value: list[str]) -> list[str]:
        cleaned = []
        for prefix in value:
            if not prefix.isdigit() or not (1 <= len(prefix) <= 6):
                raise ValueError("Pincode prefixes must be 1-6 digits.")
            cleaned.append(prefix)
        return cleaned


class ServiceAreaRead(ORMModel):
    id: str
    city_id: str
    city_name: str | None = None
    locality: str | None = None
    pincode_prefixes: list[str] = []


class CategorySelection(BaseModel):
    category_ids: list[str] = Field(min_length=1)


class OperatingHours(BaseModel):
    hours: dict[str, dict]


class DealerAvailabilityUpdate(BaseModel):
    accepts_new_requests: bool | None = None
    operating_hours: dict[str, dict] | None = None


class DealerDocumentRead(ORMModel):
    id: str
    doc_type: str
    file_name: str
    mime_type: str
    size_bytes: int
    status: str
    review_notes: str | None = None
    created_at: datetime


class DealerSummary(ORMModel):
    id: str
    business_name: str
    status: str
    verified: bool = False
    city_id: str
    locality: str | None = None
    rating_avg: Decimal = Decimal("0")
    rating_count: int = 0
    completed_jobs: int = 0
    cancelled_jobs: int = 0
    min_collection_kg: Decimal = Decimal("0")
    accepts_new_requests: bool = True
    verification_notes: str | None = None
    rejection_reason: str | None = None
    operating_hours: dict = {}
    description: str | None = None
    categories: list[CategoryRead] = []
    service_areas: list[ServiceAreaRead] = []
    documents: list[DealerDocumentRead] = []


class DealerRequestRead(BaseModel):
    id: str
    reference: str
    locality: str
    postal_code_masked: str
    city_name: str
    preferred_date: date
    time_window: str
    estimated_total_weight_kg: Decimal | None
    materials: list[str]
    item_count: int
    image_count: int
    has_offer: bool
    created_at: datetime
    expires_at: datetime | None = None


class DashboardCounts(BaseModel):
    active_listings: int = 0
    incoming_offers: int = 0
    upcoming_pickups: int = 0
    ongoing_collections: int = 0
    completed_transactions: int = 0
    total_earnings: Decimal = Decimal("0")
    pending_settlements: int = 0


class DealerDashboard(BaseModel):
    profile: DealerSummary | None
    available_requests: int = 0
    pending_offers: int = 0
    accepted_jobs: int = 0
    todays_pickups: int = 0
    completed_jobs: int = 0
    cancellation_rate: Decimal = Decimal("0")
    rating_avg: Decimal = Decimal("0")
    rating_count: int = 0
    recorded_earnings: Decimal = Decimal("0")
    unread_notifications: int = 0


# ---------------------------------------------------------------------------
# Bookings & settlement
# ---------------------------------------------------------------------------


class BookingPerson(BaseModel):
    name: str | None = None
    phone: str | None = None


class BookingAddress(BaseModel):
    line1: str | None = None
    line2: str | None = None
    locality: str | None = None
    postal_code: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None


class SettlementItemRead(BaseModel):
    id: str
    category_id: str
    category_name: str
    actual_weight_kg: Decimal
    accepted_rate_per_kg: Decimal
    final_rate_per_kg: Decimal
    line_total: Decimal
    rate_changed: bool
    change_reason: str | None = None
    customer_consent_required: bool
    customer_consent: str | None = None


class PaymentRead(ORMModel):
    id: str
    method: str
    amount: Decimal
    status: str
    upi_reference: str | None = None
    payer_note: str | None = None
    recorded_at: datetime
    customer_confirmed_at: datetime | None = None
    verified_at: datetime | None = None
    gateway_verified: bool = False


class SettlementRead(ORMModel):
    id: str
    version: int
    status: str
    gross_amount: Decimal
    deductions: Decimal
    adjustments: Decimal
    platform_fee: Decimal
    final_payout: Decimal
    deduction_reason: str | None = None
    notes: str | None = None
    submitted_at: datetime
    customer_confirmed_at: datetime | None = None
    items: list[SettlementItemRead] = []
    payments: list[PaymentRead] = []
    calculation: dict = {}


class StatusHistoryRead(ORMModel):
    from_status: str | None = None
    to_status: str
    actor_role: str
    reason: str | None = None
    created_at: datetime


class BookingRead(BaseModel):
    id: str
    reference: str
    request_id: str
    request_reference: str
    status: str
    scheduled_date: date
    time_window: str
    accepted_payout: Decimal
    created_at: datetime
    confirmed_at: datetime | None = None
    pickup_started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancellation_reason: str | None = None
    customer: BookingPerson
    dealer: DealerPublic
    address: BookingAddress | None = None
    materials: list[str] = []
    settlement: SettlementRead | None = None
    latest_settlement: SettlementRead | None = None
    payments: list[PaymentRead] = []
    history: list[StatusHistoryRead] = []
    measurements: list[SettlementItemRead] = []
    evidence: list[dict] = []
    allowed_actions: list[str] = []
    has_review: bool = False
    open_dispute_id: str | None = None
    offer_snapshot: dict = {}


class CancelBookingBody(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class WeighingItemIn(BaseModel):
    category_id: str
    actual_weight_kg: Decimal = Field(ge=0, le=MAX_QUANTITY_KG)


class RecordWeighingBody(BaseModel):
    items: list[WeighingItemIn] = Field(min_length=1, max_length=12)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("items")
    @classmethod
    def _unique(cls, value: list[WeighingItemIn]) -> list[WeighingItemIn]:
        ids = [i.category_id for i in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Each material can appear only once.")
        return value


class SettlementLineIn(BaseModel):
    category_id: str
    actual_weight_kg: Decimal = Field(ge=0, le=MAX_QUANTITY_KG)
    final_rate_per_kg: Decimal | None = Field(default=None, ge=0, le=MAX_RATE_PER_KG)
    change_reason: str | None = Field(default=None, max_length=500)


class SubmitSettlementBody(BaseModel):
    items: list[SettlementLineIn] = Field(min_length=1, max_length=12)
    deductions: Decimal = Field(default=Decimal("0"), ge=0)
    deduction_reason: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("items")
    @classmethod
    def _unique(cls, value: list[SettlementLineIn]) -> list[SettlementLineIn]:
        ids = [i.category_id for i in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Each material can appear only once.")
        return value

    @model_validator(mode="after")
    def _deduction_reason(self) -> "SubmitSettlementBody":
        if self.deductions > 0 and not self.deduction_reason:
            raise ValueError("A reason is required for any deduction.")
        return self


class RecordPaymentBody(BaseModel):
    method: Literal["cash", "upi"]
    amount: Decimal | None = Field(default=None, ge=0)
    upi_reference: str | None = Field(default=None, max_length=120)
    payer_note: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _upi_reference(self) -> "RecordPaymentBody":
        if self.method == "upi" and not (self.upi_reference or "").strip():
            raise ValueError("Enter the UPI transaction reference.")
        return self


class ConfirmSettlementBody(BaseModel):
    approve: bool = True
    note: str | None = Field(default=None, max_length=500)


class ConfirmPaymentBody(BaseModel):
    payment_id: str | None = None


class DisputeCreateBody(BaseModel):
    category: Literal["weight", "material_quality", "payment", "conduct", "other"]
    description: str = Field(min_length=10, max_length=2000)


class ResolveDisputeBody(BaseModel):
    resolution: str = Field(min_length=5, max_length=2000)
    outcome: Literal["resolved", "rejected", "adjust_settlement"]
    adjusted_final_payout: Decimal | None = Field(default=None, ge=0)
    # An admin may only lower a payout by recording a deduction and a reason;
    # silent reductions below the computed gross are not allowed.
    adjusted_deductions: Decimal | None = Field(default=None, ge=0)
    deduction_reason: str | None = Field(default=None, min_length=3, max_length=500)
    booking_status_after: Literal["settlement_pending", "completed", "cancelled"] | None = None


# ---------------------------------------------------------------------------
# Reviews, support, notifications
# ---------------------------------------------------------------------------


class ReviewCreate(BaseModel):
    booking_id: str
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class ReviewRead(ORMModel):
    id: str
    booking_id: str
    rating: int
    comment: str | None = None
    status: str
    created_at: datetime
    customer_name: str | None = None
    dealer_name: str | None = None


class SupportTicketCreate(BaseModel):
    subject: str = Field(min_length=5, max_length=200)
    message: str = Field(min_length=10, max_length=2000)
    category: Literal["general", "booking", "payment", "dealer", "technical"] = "general"


class SupportTicketRead(ORMModel):
    id: str
    reference: str
    subject: str
    message: str
    category: str
    status: str
    priority: str
    resolution: str | None = None
    created_at: datetime
    updated_at: datetime


class NotificationRead(ORMModel):
    id: str
    type: str
    title: str
    body: str
    data: dict = {}
    is_read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationRead]
    unread: int


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------


class AdminMetrics(BaseModel):
    customers: int = 0
    dealers_verified: int = 0
    dealers_pending: int = 0
    new_requests: int = 0
    offers_received: int = 0
    bookings_in_progress: int = 0
    completed_collections: int = 0
    gross_transaction_value: Decimal = Decimal("0")
    platform_revenue: Decimal = Decimal("0")
    cancellation_rate: Decimal = Decimal("0")
    dispute_rate: Decimal = Decimal("0")
    payouts_recorded: Decimal = Decimal("0")
    pending_dealer_verifications: int = 0
    open_disputes: int = 0
    open_support_tickets: int = 0
    category_volume: list[dict] = []
    city_activity: list[dict] = []
    definitions: dict = {}


class AdminDealerRow(BaseModel):
    id: str
    user_id: str
    phone_masked: str
    business_name: str
    contact_person: str
    city_name: str | None = None
    locality: str | None = None
    status: str
    verification_notes: str | None = None
    rejection_reason: str | None = None
    rating_avg: Decimal = Decimal("0")
    rating_count: int = 0
    completed_jobs: int = 0
    document_count: int = 0
    created_at: datetime
    documents: list[DealerDocumentRead] = []


class AdminDealerAction(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class AdminUserRow(BaseModel):
    id: str
    phone_masked: str
    name: str | None = None
    role: str
    status: str
    created_at: datetime
    last_login_at: datetime | None = None
    dealer_status: str | None = None


class AdminUserAction(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class CategoryCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    unit: Literal["kg", "piece"] = "kg"
    icon: str = Field(default="recycle", max_length=40)
    is_active: bool = True
    requires_special_handling: bool = False
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    unit: Literal["kg", "piece"] | None = None
    icon: str | None = Field(default=None, max_length=40)
    is_active: bool | None = None
    requires_special_handling: bool | None = None
    sort_order: int | None = None


class FeeRuleCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    fee_type: Literal["percent", "flat"] = "percent"
    value: Decimal = Field(ge=0, le=100000)
    applies_to: Literal["customer", "dealer"] = "customer"
    city_id: str | None = None
    effective_from: date
    effective_to: date | None = None


class FeeRuleRead(ORMModel):
    id: str
    name: str
    fee_type: str
    value: Decimal
    applies_to: str
    city_id: str | None = None
    is_active: bool
    effective_from: date
    effective_to: date | None = None


class AuditLogRead(ORMModel):
    id: str
    actor_id: str | None = None
    actor_role: str | None = None
    action: str
    entity_type: str
    entity_id: str | None = None
    reason: str | None = None
    before: dict | None = None
    after: dict | None = None
    created_at: datetime


class AdminReviewAction(BaseModel):
    action: Literal["hide", "publish", "flag"]
    note: str | None = Field(default=None, max_length=500)


class SupportTicketUpdate(BaseModel):
    status: Literal["open", "in_progress", "resolved", "closed"]
    resolution: str | None = Field(default=None, max_length=2000)


class UserReportCreate(BaseModel):
    reported_user_id: str
    reason: Literal["harassment", "fraud", "spam", "safety", "other"]
    details: str = Field(min_length=10, max_length=2000)


class UserReportResolve(BaseModel):
    status: Literal["resolved", "dismissed"]
    resolution: str = Field(min_length=3, max_length=2000)


class CityCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    state: str = Field(min_length=2, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    timezone: str = "Asia/Kolkata"
    is_active: bool = True


class CityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    state: str | None = Field(default=None, min_length=2, max_length=120)
    is_active: bool | None = None


class AdminSupportRow(ORMModel):
    id: str
    reference: str
    user_id: str
    subject: str
    message: str
    category: str
    status: str
    priority: str
    resolution: str | None = None
    created_at: datetime


class DealerOfferRevision(BaseModel):
    items: list[OfferItemIn] = Field(min_length=1, max_length=12)
    min_total_weight_kg: Decimal | None = None
    pickup_date: date | None = None
    pickup_window: Literal["morning", "midday", "afternoon", "evening"] | None = None
    valid_until: datetime | None = None
    conditions: str | None = None
    disclosure: str | None = None


# resolve forward refs
MeResponse.model_rebuild()

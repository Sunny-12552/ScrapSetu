"""Payment provider abstraction.

The MVP records externally completed cash/UPI transfers. No card or UPI
credentials are ever stored, and nothing here ever claims gateway verification.
A gateway implementation must verify webhook signatures server-side and be
idempotent (see docs/business-rules.md).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal

from app.core.config import settings


@dataclass
class PaymentIntent:
    reference: str
    amount: Decimal
    status: str
    verified: bool
    provider: str


class PaymentProvider(ABC):
    name: str

    @abstractmethod
    def create_intent(self, booking_id: str, amount: Decimal) -> PaymentIntent: ...

    @abstractmethod
    def verify_webhook(self, payload: bytes, signature: str | None) -> bool: ...


class ManualPaymentProvider(PaymentProvider):
    """Cash/UPI transfers recorded by the dealer and confirmed by the customer."""

    name = "manual"

    def create_intent(self, booking_id: str, amount: Decimal) -> PaymentIntent:
        return PaymentIntent(
            reference=f"manual-{booking_id}",
            amount=amount,
            status="recorded_externally",
            verified=False,
            provider=self.name,
        )

    def verify_webhook(self, payload: bytes, signature: str | None) -> bool:
        return False


def get_payment_provider() -> PaymentProvider:
    return ManualPaymentProvider()


def provider_status() -> dict:
    return {
        "provider": settings.payment_gateway,
        "configured": True,
        "gateway_verification_available": False,
        "note": "Cash/UPI transfers are externally recorded and customer-confirmed, not gateway-verified.",
    }

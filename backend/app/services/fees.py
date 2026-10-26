"""Platform fee resolution. Customer payouts default to zero deductions."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FeeAppliesTo, PlatformFeeRule
from app.services.settlement import resolve_platform_fee


def active_fee_rule(
    db: Session, *, applies_to: str, city_id: str | None, on: date
) -> PlatformFeeRule | None:
    rows = (
        db.execute(
            select(PlatformFeeRule).where(
                PlatformFeeRule.applies_to == applies_to,
                PlatformFeeRule.is_active.is_(True),
                PlatformFeeRule.effective_from <= on,
            )
        )
        .scalars()
        .all()
    )
    usable = [
        row
        for row in rows
        if (row.effective_to is None or row.effective_to >= on)
        and (row.city_id is None or row.city_id == city_id)
    ]
    if not usable:
        return None
    # City-specific overrides global.
    usable.sort(key=lambda row: (row.city_id is not None, row.effective_from), reverse=True)
    return usable[0]


def customer_platform_fee(db: Session, *, city_id: str | None, gross: Decimal, on: date) -> Decimal:
    rule = active_fee_rule(
        db, applies_to=FeeAppliesTo.CUSTOMER.value, city_id=city_id, on=on
    )
    if not rule:
        return Decimal("0.00")
    return resolve_platform_fee(gross, fee_type=rule.fee_type, value=rule.value)

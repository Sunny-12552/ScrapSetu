"""Pure monetary calculations. No database, no I/O — fully unit-testable.

All amounts are INR Decimals. Rounding policy: half-up to 2 decimal places per
line, then sum the rounded lines (documented in docs/business-rules.md).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Iterable


class CalculationError(ValueError):
    pass


def money(value: Decimal | int | str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise CalculationError("Invalid monetary amount.") from exc


def q2(value: Decimal) -> Decimal:
    return money(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def q3(value: Decimal) -> Decimal:
    return money(value).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def line_total(weight_kg: Decimal, rate_per_kg: Decimal) -> Decimal:
    if weight_kg < 0:
        raise CalculationError("Weight cannot be negative.")
    if rate_per_kg < 0:
        raise CalculationError("Rate cannot be negative.")
    return q2(money(weight_kg) * money(rate_per_kg))


@dataclass(frozen=True)
class PayoutLine:
    weight_kg: Decimal
    rate_per_kg: Decimal
    total: Decimal


@dataclass(frozen=True)
class PayoutResult:
    lines: list[PayoutLine]
    gross: Decimal
    deductions: Decimal
    adjustments: Decimal
    platform_fee: Decimal
    final_payout: Decimal
    warnings: list[str] = field(default_factory=list)


def calculate_payout(
    lines: Iterable[tuple[Decimal, Decimal]],
    *,
    deductions: Decimal = Decimal("0"),
    adjustments: Decimal = Decimal("0"),
    platform_fee: Decimal = Decimal("0"),
) -> PayoutResult:
    """Compute a settlement with explicit, reproducible arithmetic."""
    deductions = q2(deductions)
    adjustments = q2(adjustments)
    platform_fee = q2(platform_fee)
    if deductions < 0:
        raise CalculationError("Deductions cannot be negative.")
    if adjustments < 0:
        raise CalculationError("Adjustments cannot be negative.")
    if platform_fee < 0:
        raise CalculationError("Platform fee cannot be negative.")

    computed: list[PayoutLine] = []
    warnings: list[str] = []
    for weight, rate in lines:
        total = line_total(weight, rate)
        computed.append(PayoutLine(money(weight), money(rate), total))

    gross = q2(sum((line.total for line in computed), Decimal("0")))
    total_reductions = deductions + platform_fee
    if total_reductions > gross:
        raise CalculationError(
            "Deductions and fees cannot exceed the gross settlement value."
        )
    final = q2(gross - total_reductions + adjustments)
    if final < 0:
        raise CalculationError("Final payout cannot be negative.")
    if not computed:
        raise CalculationError("A settlement needs at least one material line.")
    if gross == 0:
        warnings.append("Gross payout is zero. Confirm the measured weights are correct.")
    return PayoutResult(
        lines=computed,
        gross=gross,
        deductions=deductions,
        adjustments=adjustments,
        platform_fee=platform_fee,
        final_payout=final,
        warnings=warnings,
    )


def indicative_payout(
    lines: Iterable[tuple[Decimal, Decimal]],
) -> Decimal:
    return q2(
        sum((line_total(weight, rate) for weight, rate in lines), Decimal("0"))
    )


def percent_fee(base: Decimal, percent: Decimal) -> Decimal:
    return q2(money(base) * money(percent) / Decimal("100"))


def resolve_platform_fee(
    gross: Decimal,
    *,
    fee_type: str | None,
    value: Decimal | None,
) -> Decimal:
    """Fee rules default to zero. Only an explicit active rule charges a fee."""
    if not fee_type or value is None or value <= 0:
        return Decimal("0.00")
    if fee_type == "percent":
        return percent_fee(gross, value)
    if fee_type == "flat":
        return q2(value)
    raise CalculationError("Unsupported fee type.")

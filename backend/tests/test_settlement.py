"""Unit tests for decimal money math and settlement transparency."""

from decimal import Decimal

import pytest

from app.services.settlement import (
    CalculationError,
    calculate_payout,
    indicative_payout,
    line_total,
    money,
    q2,
    q3,
    resolve_platform_fee,
)


def test_money_uses_round_half_up_never_bankers():
    assert q2(Decimal("10.005")) == Decimal("10.01")
    assert q2(Decimal("10.004")) == Decimal("10.00")
    assert q2(Decimal("2.675")) == Decimal("2.68")


def test_weights_keep_three_decimals():
    assert q3(Decimal("1.2344")) == Decimal("1.234")
    assert q3(Decimal("1.2345")) == Decimal("1.235")
    assert q3(Decimal("1.2355")) == Decimal("1.236")


def test_line_total_rounds_each_line():
    assert line_total(Decimal("2.555"), Decimal("27.50")) == Decimal("70.26")


def test_payout_is_gross_minus_deductions_minus_platform_fee_plus_adjustments():
    payout = calculate_payout(
        [(Decimal("10"), Decimal("20.00")), (Decimal("2"), Decimal("100.00"))],
        deductions=Decimal("25.00"),
        adjustments=Decimal("5.00"),
        platform_fee=Decimal("10.00"),
    )
    assert payout.gross == Decimal("400.00")
    assert payout.deductions == Decimal("25.00")
    assert payout.platform_fee == Decimal("10.00")
    assert payout.adjustments == Decimal("5.00")
    assert payout.final_payout == Decimal("370.00")


def test_payout_never_returns_negative_and_reports_reason():
    with pytest.raises(CalculationError):
        calculate_payout(
            [(Decimal("1"), Decimal("10.00"))],
            deductions=Decimal("50.00"),
            adjustments=Decimal("0"),
            platform_fee=Decimal("0"),
        )


def test_payout_rejects_negative_inputs():
    with pytest.raises(CalculationError):
        calculate_payout(
            [(Decimal("-1"), Decimal("10.00"))],
            deductions=Decimal("0"),
            adjustments=Decimal("0"),
            platform_fee=Decimal("0"),
        )


def test_indicative_payout_uses_line_totals():
    assert indicative_payout(
        [(Decimal("10"), Decimal("22.50")), (Decimal("1.5"), Decimal("600.00"))]
    ) == Decimal("1125.00")


def test_platform_fee_defaults_to_zero_without_a_rule():
    assert resolve_platform_fee(
        Decimal("1000.00"), fee_type=None, value=None
    ) == Decimal("0.00")
    assert resolve_platform_fee(
        Decimal("1000.00"), fee_type="percent", value=Decimal("2")
    ) == Decimal("20.00")
    assert resolve_platform_fee(
        Decimal("1000.00"), fee_type="flat", value=Decimal("15")
    ) == Decimal("15.00")

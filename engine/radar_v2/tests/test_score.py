from datetime import datetime, timedelta, timezone

import pytest

from radar_v2.engine.score import (
    category_score,
    confluence_multiplier,
    score_ticker,
    signal_score,
)
from radar_v2.signals.schema import Signal


def make_signal(
    category: str,
    *,
    signal_type: str = "test_signal",
    magnitude: float = 1.0,
    confidence: float = 1.0,
    direction: int = 1,
    event_time: datetime | None = None,
    half_life_days: float = 10,
) -> Signal:
    return Signal(
        ticker="KTOS",
        signal_type=signal_type,
        category=category,
        direction=direction,
        magnitude=magnitude,
        confidence=confidence,
        event_time=event_time or datetime(2026, 6, 1, tzinfo=timezone.utc),
        half_life_days=half_life_days,
        source_url=f"https://source/{signal_type}",
        evidence=f"{signal_type} fired.",
    )


def test_signal_score_halves_at_half_life():
    start = datetime(2026, 6, 1, tzinfo=timezone.utc)
    sig = make_signal("INSIDER_SMART_MONEY", event_time=start, half_life_days=20)

    assert signal_score(sig, start + timedelta(days=20)) == pytest.approx(0.5)


def test_category_score_saturates_same_category_signals():
    one = category_score([0.6])
    two = category_score([0.6, 0.6])

    assert one == pytest.approx(0.6)
    assert two == pytest.approx(0.9)
    assert two - one <= one * 0.5


def test_confluence_multiplier_counts_only_eligible_categories():
    category_scores = {
        "INSIDER_SMART_MONEY": 0.4,
        "GOVERNMENT_REGULATORY": 0.5,
        "COMMERCIAL_DEALS": 0.6,
        "NARRATIVE_SENTIMENT": 0.9,
        "CONTEXT_REGIME": 0.9,
    }

    result = confluence_multiplier(category_scores)

    assert result["k"] == 3
    assert result["multiplier"] == pytest.approx(1.5)
    assert result["triple_signal"] is True


def test_context_regime_signals_do_not_change_radar_score():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    base = [make_signal("INSIDER_SMART_MONEY", magnitude=0.8, confidence=0.9)]
    with_context = base + [make_signal("CONTEXT_REGIME", magnitude=1.0, confidence=1.0)]

    assert score_ticker("KTOS", base, now=now)["radar_score"] == score_ticker("KTOS", with_context, now=now)["radar_score"]
    assert score_ticker("KTOS", with_context, now=now)["regime_flags"] == ["test_signal"]


def test_narrative_only_signals_cannot_pass_75_gate():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    signals = [
        make_signal("NARRATIVE_SENTIMENT", signal_type=f"news_velocity_{i}", magnitude=1.0, confidence=1.0)
        for i in range(5)
    ]

    result = score_ticker("KTOS", signals, now=now)

    assert result["radar_score"] < 75
    assert result["gate_pass"] is False


def test_score_breakdown_contains_signal_ledger():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    signals = [
        make_signal("INSIDER_SMART_MONEY", signal_type="insider_cluster_buy", magnitude=1, confidence=1),
        make_signal("GOVERNMENT_REGULATORY", signal_type="gov_contract_award", magnitude=1, confidence=1),
        make_signal("COMMERCIAL_DEALS", signal_type="partnership_deal", magnitude=1, confidence=1),
    ]

    result = score_ticker("KTOS", signals, now=now, crowding_value=0.0)

    assert result["ticker"] == "KTOS"
    assert result["radar_score"] >= 75
    assert result["confluence"]["triple_signal"] is True
    assert result["signals"][0]["type"] == "insider_cluster_buy"
    assert result["signals"][0]["decayed_score"] == pytest.approx(1.0)

"""Unit tests for the M4 free-source adapters and the Supabase write contract.

These test the pure mapping logic (no network) by calling each adapter's
signals_from_* / signal_for_ticker helper with injected data, mirroring how the
ported SEC-adapter tests inject a fake scan result.
"""

from datetime import datetime, timezone

import pytest

from radar_v2.signals.adapters import (
    momentum,
    news_rss,
    openfda,
    short_interest,
    usaspending,
    volume_anomaly,
)
from radar_v2.signals.schema import CATEGORIES

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def test_usaspending_aggregates_awards_into_one_gov_signal():
    awards = [
        {"Award Amount": 48_000_000, "Awarding Agency": "Department of Defense"},
        {"Award Amount": 2_000_000, "Awarding Agency": "DARPA"},
    ]
    sigs = usaspending.signals_from_awards("KTOS", awards, now=NOW)
    assert len(sigs) == 1
    s = sigs[0]
    assert s.signal_type == "gov_contract_award"
    assert s.category == "GOVERNMENT_REGULATORY"
    assert s.direction == 1
    assert 0.0 <= s.magnitude <= 1.0
    assert s.raw["total_usd"] == 50_000_000
    s.validate()  # must satisfy the schema contract


def test_usaspending_no_awards_emits_nothing():
    assert usaspending.signals_from_awards("KTOS", [], now=NOW) == []


def test_momentum_positive_is_bullish_price_volume_signal():
    # 252 sessions: ramp from 100 to 150 with a slight pullback in the last month.
    closes = [100.0 + i * 0.2 for i in range(252)]
    sigs = momentum.signal_for_ticker("AAA", closes, now=NOW)
    assert len(sigs) == 1
    assert sigs[0].signal_type == "momentum_12_1"
    assert sigs[0].category == "PRICE_VOLUME_STRUCTURE"
    assert sigs[0].direction == 1


def test_momentum_insufficient_history_emits_nothing():
    assert momentum.signal_for_ticker("AAA", [100.0] * 10, now=NOW) == []


def test_volume_anomaly_fires_only_on_outlier_volume():
    # 21 baseline sessions with mild volume variance, then a 10x spike up day.
    rows = [(100.0, 1_000_000.0 + (i % 3) * 50_000.0) for i in range(21)]
    rows.append((105.0, 10_000_000.0))
    sigs = volume_anomaly.signal_for_ticker("AAA", rows, now=NOW)
    assert len(sigs) == 1
    assert sigs[0].signal_type == "volume_anomaly"
    assert sigs[0].direction == 1  # closed up


def test_volume_anomaly_quiet_volume_emits_nothing():
    rows = [(100.0, 1_000_000.0) for _ in range(22)]
    assert volume_anomaly.signal_for_ticker("AAA", rows, now=NOW) == []


def test_short_interest_threshold_and_direction():
    assert short_interest.signal_for_ticker("AAA", 0.05, now=NOW) == []  # below 10%
    sigs = short_interest.signal_for_ticker("AAA", 0.22, now=NOW)
    assert len(sigs) == 1
    assert sigs[0].category == "STREET_POSITIONING"
    assert sigs[0].raw["short_percent_of_float"] == 0.22


def test_news_velocity_is_capped_narrative_category():
    sigs = news_rss.signal_for_ticker("AAA", 12, now=NOW)
    assert len(sigs) == 1
    assert sigs[0].category == "NARRATIVE_SENTIMENT"
    assert sigs[0].half_life_days == 3  # fast decay


def test_openfda_counts_submissions():
    results = [{"application_number": "NDA123", "submissions": [{}, {}, {}]}]
    sigs = openfda.signals_from_results("AAA", results, now=NOW)
    assert len(sigs) == 1
    assert sigs[0].category == "GOVERNMENT_REGULATORY"


def test_every_m4_signal_uses_a_valid_category():
    produced = []
    produced += usaspending.signals_from_awards("KTOS", [{"Award Amount": 5_000_000}], now=NOW)
    produced += momentum.signal_for_ticker("AAA", [100.0 + i for i in range(252)], now=NOW)
    produced += short_interest.signal_for_ticker("AAA", 0.2, now=NOW)
    produced += news_rss.signal_for_ticker("AAA", 5, now=NOW)
    for s in produced:
        assert s.category in CATEGORIES
        s.validate()

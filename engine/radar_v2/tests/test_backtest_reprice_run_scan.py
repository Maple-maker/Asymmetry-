from datetime import datetime, timezone

import pytest

from radar_v2.backtest.costs import spread_haircut
from radar_v2.backtest.event_study import LookaheadError, abnormal_return, event_return
from radar_v2.backtest.report import render_honesty_guards
from radar_v2.engine.reprice import compute_reprice_gap
from radar_v2.run_scan import run_scan
from radar_v2.signals.schema import Signal


def test_event_return_uses_first_session_after_event_time():
    event_time = datetime(2026, 6, 1, 21, 30, tzinfo=timezone.utc)
    prices = [
        {"date": "2026-06-01", "open": 100, "close": 101},
        {"date": "2026-06-02", "open": 102, "close": 112.2},
    ]

    result = event_return(event_time, prices, horizon_days=1)

    assert result == pytest.approx(0.10)


def test_lookahead_error_when_entry_is_before_public_event_time():
    event_time = datetime(2026, 6, 2, 21, 30, tzinfo=timezone.utc)
    prices = [{"date": "2026-06-02", "open": 100, "close": 110}]

    with pytest.raises(LookaheadError):
        event_return(event_time, prices, horizon_days=1)


def test_abnormal_return_subtracts_sector_benchmark_and_costs():
    assert abnormal_return(0.12, 0.03, 0.01) == pytest.approx(0.08)


def test_spread_haircut_uses_liquidity_buckets_round_trip():
    assert spread_haircut(20_000_000) == pytest.approx(0.002)
    assert spread_haircut(5_000_000) == pytest.approx(0.007)
    assert spread_haircut(500_000) == pytest.approx(0.015)


def test_reprice_gap_consumes_drift_curve():
    drift_curves = {
        "gov_contract_award": {"0": 0.0, "6": 0.02, "63": 0.09},
    }

    result = compute_reprice_gap(
        signal_type="gov_contract_award",
        days_elapsed=6,
        realized_abnormal_move=0.01,
        drift_curves=drift_curves,
    )

    assert result["expected_drift_remaining_pct"] == pytest.approx(8.0)
    assert result["window_elapsed_pct"] == pytest.approx(9.52, abs=0.01)


def test_report_prints_required_honesty_guards():
    text = render_honesty_guards(delisted_coverage=False)

    assert "Point-in-time assertion" in text
    assert "INDICATIVE ONLY" in text
    assert "survivorship" in text.lower()
    assert "Multiple-comparisons caution" in text


def test_run_scan_dry_run_returns_score_without_writing():
    sig = Signal(
        ticker="KTOS",
        signal_type="gov_contract_award",
        category="GOVERNMENT_REGULATORY",
        direction=1,
        magnitude=1,
        confidence=1,
        event_time=datetime(2026, 6, 1, tzinfo=timezone.utc),
        half_life_days=21,
        source_url="https://source/award",
        evidence="$KTOS won a contract.",
    )

    result = run_scan(
        tickers=["KTOS"],
        now=datetime(2026, 6, 1, tzinfo=timezone.utc),
        adapter_fetchers=[lambda tickers, since: [sig]],
        dry_run=True,
    )

    assert result["dry_run"] is True
    assert result["results"][0]["ticker"] == "KTOS"
    assert result["results"][0]["signals"][0]["type"] == "gov_contract_award"
    assert "gate_pass" in result["results"][0]

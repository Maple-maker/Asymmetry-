"""Tests for the Supabase write contract layer (the integration seam).

Covers: (1) the no-op seam returns without writing when credentials/package are
absent, and (2) the result -> column mapping matches the roadmap contract.
"""

from datetime import datetime, timezone

from radar_v2 import supabase_writer
from radar_v2.engine.score import score_ticker
from radar_v2.signals.schema import Signal

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _scored():
    sig = Signal(
        ticker="KTOS",
        signal_type="gov_contract_award",
        category="GOVERNMENT_REGULATORY",
        direction=1,
        magnitude=1.0,
        confidence=1.0,
        event_time=NOW,
        half_life_days=21,
        source_url="https://source/award",
        evidence="$KTOS won a contract.",
    )
    return score_ticker("KTOS", [sig], now=NOW)


def test_opportunity_row_matches_contract():
    row = supabase_writer.opportunity_row(_scored(), as_of=NOW)
    # roadmap radar_opportunities contract
    assert row["ticker"] == "KTOS"
    assert isinstance(row["radar_score"], int)
    assert row["as_of"] == NOW.isoformat()
    assert isinstance(row["top_signals"], list)
    assert row["top_signals"][0]["type"] == "gov_contract_award"
    # §4.6 breakdown object lives in score_breakdown
    assert set(row["score_breakdown"]) == {"category_scores", "confluence", "crowding"}
    assert row["council_explanation"] is None  # written by R4 (M5)


def test_snapshot_row_computes_score_delta():
    result = _scored()
    row = supabase_writer.snapshot_row(
        result, holding_id="h1", user_id="u1", snapshot_date="2026-06-01", prior_score=result["radar_score"] - 10
    )
    assert row["score_delta"] == 10
    assert row["user_id"] == "u1"
    assert row["holding_id"] == "h1"


def test_write_results_is_noop_without_credentials(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    out = supabase_writer.write_results([_scored()], as_of=NOW)
    assert out["written"] is False
    assert out["reason"] == "no_supabase"
    assert len(out["rows"]) == 1  # row was built, just not persisted

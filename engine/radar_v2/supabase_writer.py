"""
Supabase write contract layer (M4).

This module maps the engine's ``score_ticker()`` output onto the two Supabase
tables Radar V2 writes — ``radar_opportunities`` (shared feed) and
``holding_snapshots`` (per-user) — per the port plan / roadmap §Schema.

IMPORTANT (compliance + ops):
  * The actual DB write is a CLEARLY-MARKED NO-OP SEAM. If the ``supabase``
    package is not installed, or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
    not set in the environment, ``write_results()`` does NOT touch any database.
    It returns a dry payload so the engine always runs without a live DB.
  * The >=75 gate runs inside ``score_ticker()`` BEFORE this writer is ever
    called, and before any AI/Council step (M5). This writer only persists what
    the deterministic engine already produced — it never scores or filters.

Roadmap column reconciliation (port-plan blocker #7): the roadmap is the
authority. ``radar_opportunities`` carries ``top_signals`` (the ranked ledger).
We ALSO write ``score_breakdown`` / ``regime_flags`` when those columns exist
(No-Fomo migration), but the roadmap's ``top_signals`` is the contract.
"""

import os
import sys
from datetime import datetime
from typing import Any


def _client():
    """Return a Supabase client, or None if unavailable (no-op seam).

    Returns None when the supabase package is missing OR credentials are absent.
    The service-role key is required because radar_opportunities is a
    service-role-write / auth-read shared feed.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore
    except Exception:
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None


def opportunity_row(result: dict[str, Any], as_of: datetime) -> dict[str, Any]:
    """Map one score_ticker() result onto a radar_opportunities row.

    Column sources (roadmap §Schema + port-plan write contract):
      ticker, radar_score   <- result
      top_signals (jsonb)   <- the ranked signal ledger
      reprice_gap (jsonb)   <- result (null until R3 backtest ships)
      as_of                 <- scan timestamp; unique(ticker, as_of)
      score_breakdown(jsonb)<- category_scores + confluence + crowding (§4.6)
      regime_flags (text[]) <- result
    """
    return {
        "ticker": result["ticker"],
        "radar_score": result["radar_score"],
        "top_signals": result["signals"],
        "reprice_gap": result.get("reprice_gap"),
        "as_of": as_of.isoformat(),
        "score_breakdown": {
            "category_scores": result["category_scores"],
            "confluence": result["confluence"],
            "crowding": result["crowding"],
        },
        "regime_flags": result.get("regime_flags", []),
        # council_explanation is written by R4 (M5); null here by design.
        "council_explanation": None,
    }


def snapshot_row(
    result: dict[str, Any],
    *,
    holding_id: str,
    user_id: str,
    snapshot_date: str,
    prior_score: int | None = None,
) -> dict[str, Any]:
    """Map a result onto a holding_snapshots row for one user-held ticker.

    score_delta = today's radar_score minus the prior snapshot's score
    (None when there is no prior snapshot to diff against).
    """
    radar_score = result["radar_score"]
    score_delta = None if prior_score is None else radar_score - prior_score
    return {
        "holding_id": holding_id,
        "user_id": user_id,
        "ticker": result["ticker"],
        "snapshot_date": snapshot_date,
        "radar_score": radar_score,
        "score_delta": score_delta,
        "reprice_gap": result.get("reprice_gap"),
        "top_signals": result["signals"],
    }


def write_results(
    results: list[dict[str, Any]],
    *,
    as_of: datetime,
    table: str = "radar_opportunities",
) -> dict[str, Any]:
    """Persist scored results to radar_opportunities (the shared feed).

    NO-OP SEAM: returns ``{"written": False, ...}`` without any DB call when
    Supabase is unavailable. Per-user holding_snapshots are written by the
    caller (which knows the user/holding context) via snapshot_row() — the
    shared feed has no user_id and is written here.
    """
    rows = [opportunity_row(r, as_of) for r in results]
    client = _client()
    if client is None:
        print(
            "[radar_v2.supabase_writer] no-op: Supabase client/credentials absent; "
            f"would have upserted {len(rows)} row(s) into {table}.",
            file=sys.stderr,
        )
        return {"written": False, "reason": "no_supabase", "rows": rows}

    try:
        # unique(ticker, as_of) — upsert is idempotent within a scan.
        client.table(table).upsert(rows, on_conflict="ticker,as_of").execute()
        return {"written": True, "count": len(rows)}
    except Exception as exc:
        print(f"[radar_v2.supabase_writer] write failed: {exc}", file=sys.stderr)
        return {"written": False, "reason": str(exc), "rows": rows}

"""
Regime / macro adapter — VIX (free) + macro context (free).

Emits CONTEXT_REGIME signals ONLY. Per the house rule (spec §4.3, roadmap
compliance #3) CONTEXT_REGIME has weight 0.0 in the engine: these flags ANNOTATE
a card, they never filter or rank it. This adapter therefore cannot change a
RadarScore — a dedicated unit test in the ported test suite proves that.

Two sources, both free:
  * VIX level from Yahoo Finance (^VIX). Reuses engine/regime.py::vix_regime_flag,
    which emits a VIX_ELEVATED flag when VIX >= 25.
  * (Optional) macro regime context from the ported legacy macro_scraper
    (World Bank / IMF / DBnomics) — slow-moving, surfaced as a flag only.

The VIX flag is ticker-scoped because Signal requires a ticker, but it carries
no weight, so attaching the same market-wide flag to every scanned ticker is
purely cosmetic/auditable.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from radar_v2.engine.regime import vix_regime_flag
from radar_v2.signals.schema import Signal


def _vix_level() -> float | None:
    """Latest VIX close from Yahoo (^VIX), or None on error."""
    try:
        import yfinance as yf
    except Exception:
        return None
    try:
        hist = yf.Ticker("^VIX").history(period="5d", interval="1d")
        if hist is None or hist.empty:
            return None
        return float(hist["Close"].dropna().values[-1])
    except Exception:
        return None


def fetch(tickers: list[str] | None, since: datetime) -> list[Signal]:
    """Emit a CONTEXT_REGIME flag per ticker when VIX is elevated. Weight 0.0."""
    if not tickers:
        return []
    vix = _vix_level()
    if vix is None:
        return []
    now = datetime.now(timezone.utc)
    out: list[Signal] = []
    for ticker in tickers:
        try:
            sig = vix_regime_flag(ticker, vix, now=now)
            if sig is not None:
                sig.validate()
                out.append(sig)
        except Exception as exc:
            print(f"[radar_v2.regime_macro] warning {ticker}: {exc}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 regime/macro adapter (VIX, flags only)")
    parser.add_argument("--tickers", nargs="+", required=True)
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    signals = fetch(args.tickers, since)
    payload = [s.to_dict() for s in signals]
    print(json.dumps(payload, indent=2, default=str) if args.json else payload)


if __name__ == "__main__":
    main()

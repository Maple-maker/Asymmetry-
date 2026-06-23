"""
short_interest_shift adapter — free (yfinance short-interest fields).

Short interest is a STREET_POSITIONING signal. FINRA publishes consolidated
short interest bi-monthly (the canonical free source); yfinance surfaces the
same figures per ticker (shortPercentOfFloat / sharesShort) without an API key,
so we use it for M4. (Wire FINRA's bi-monthly file directly in M5 if a
point-in-time history is needed for backtesting.)

Category: STREET_POSITIONING.  half_life: 14d  (spec §3).
direction: high short interest is ambiguous — a squeeze setup (bullish) OR a
bear signal. Per spec §3 "direction by context"; with no live price context in
M4 we treat an elevated, rising-style short interest as a +1 squeeze-setup flag
and keep the raw percentage in ``raw`` so the council can argue the bear side.
magnitude rule: short % of float scaled, saturating around 30%.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from radar_v2.signals.schema import Signal


HALF_LIFE_DAYS = 14
MIN_SHORT_PCT = 0.10  # below 10% of float is not noteworthy


def _short_pct(ticker: str) -> float | None:
    """Return short % of float (0..1) from yfinance, or None on error."""
    try:
        import yfinance as yf
    except Exception:
        return None
    try:
        info = yf.Ticker(ticker).info or {}
        pct = info.get("shortPercentOfFloat")
        if pct is None:
            return None
        return float(pct)
    except Exception:
        return None


def signal_for_ticker(ticker: str, short_pct: float | None, now: datetime | None = None) -> list[Signal]:
    now = now or datetime.now(timezone.utc)
    if short_pct is None or short_pct < MIN_SHORT_PCT:
        return []
    magnitude = min(1.0, short_pct / 0.30)  # 30% of float saturates to 1.0
    sig = Signal(
        ticker=ticker.upper(),
        signal_type="short_interest_shift",
        category="STREET_POSITIONING",
        direction=1,  # treated as a squeeze-setup flag; bear case lives in raw
        magnitude=round(magnitude, 6),
        confidence=0.6,
        event_time=now,
        half_life_days=HALF_LIFE_DAYS,
        source_url=f"https://finance.yahoo.com/quote/{ticker.upper()}/key-statistics",
        evidence=f"${ticker.upper()} has {short_pct*100:.1f}% short interest as a percent of float.",
        raw={"short_percent_of_float": short_pct},
    )
    sig.validate()
    return [sig]


def fetch(tickers: list[str] | None, since: datetime) -> list[Signal]:
    if not tickers:
        return []
    out: list[Signal] = []
    for ticker in tickers:
        try:
            out.extend(signal_for_ticker(ticker, _short_pct(ticker)))
        except Exception as exc:
            print(f"[radar_v2.short_interest] warning {ticker}: {exc}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 short_interest adapter (free)")
    parser.add_argument("--tickers", nargs="+", required=True)
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    signals = fetch(args.tickers, since)
    payload = [s.to_dict() for s in signals]
    print(json.dumps(payload, indent=2, default=str) if args.json else payload)


if __name__ == "__main__":
    main()

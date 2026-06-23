"""
momentum_12_1 adapter — Yahoo Finance via yfinance (free, no API key).

Classic "12-month minus last-month" price momentum: the return over the past
~12 months EXCLUDING the most recent ~1 month (the last month is skipped because
of the well-documented short-term reversal effect). A strong positive 12-1
momentum is a bullish PRICE_VOLUME_STRUCTURE signal.

Category: PRICE_VOLUME_STRUCTURE.  half_life: 30d  (spec §3).
magnitude rule: the 12-1 return mapped into 0..1, saturating around +50%.
direction: +1 if 12-1 return > 0, else -1.

The roadmap names Yahoo/yfinance as the free M4 price/volume source. (The port
plan mentions Polygon, but Polygon needs a key and a paid tier for full history;
yfinance is free and sufficient for momentum/volume in M4.)
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from radar_v2.signals.schema import Signal


HALF_LIFE_DAYS = 30


def _closes(ticker: str):
    """Return a date-ordered list of daily closes for ~13 months, or [] on error."""
    try:
        import yfinance as yf
    except Exception:
        return []
    try:
        # 14mo of daily history covers the 12-1 lookback with margin.
        hist = yf.Ticker(ticker).history(period="14mo", interval="1d")
        if hist is None or hist.empty:
            return []
        return list(hist["Close"].dropna().values)
    except Exception:
        return []


def _momentum_12_1(closes: list[float]) -> float | None:
    """Return the 12-1 momentum as a decimal (e.g. 0.18 = +18%), or None.

    Uses ~252 trading days as a year and ~21 as a month. Needs enough history.
    """
    if len(closes) < 252:
        return None
    price_now_minus_1m = closes[-21]   # price ~1 month ago (skip last month)
    price_12m_ago = closes[-252]       # price ~12 months ago
    if price_12m_ago <= 0:
        return None
    return (price_now_minus_1m - price_12m_ago) / price_12m_ago


def signal_for_ticker(ticker: str, closes: list[float], now: datetime | None = None) -> list[Signal]:
    now = now or datetime.now(timezone.utc)
    mom = _momentum_12_1(closes)
    if mom is None or abs(mom) < 0.05:  # ignore near-flat momentum (noise)
        return []
    direction = 1 if mom > 0 else -1
    magnitude = min(1.0, abs(mom) / 0.5)  # +/-50% saturates to 1.0
    sig = Signal(
        ticker=ticker.upper(),
        signal_type="momentum_12_1",
        category="PRICE_VOLUME_STRUCTURE",
        direction=direction,
        magnitude=round(magnitude, 6),
        confidence=0.7,
        event_time=now,
        half_life_days=HALF_LIFE_DAYS,
        source_url=f"https://finance.yahoo.com/quote/{ticker.upper()}",
        evidence=f"${ticker.upper()} has {mom*100:+.0f}% 12-1 momentum (12-month return excluding the last month).",
        raw={"momentum_12_1": mom},
    )
    sig.validate()
    return [sig]


def fetch(tickers: list[str] | None, since: datetime) -> list[Signal]:
    if not tickers:
        return []
    out: list[Signal] = []
    for ticker in tickers:
        try:
            out.extend(signal_for_ticker(ticker, _closes(ticker)))
        except Exception as exc:
            print(f"[radar_v2.momentum] warning {ticker}: {exc}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 momentum_12_1 adapter (yfinance)")
    parser.add_argument("--tickers", nargs="+", required=True)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    signals = fetch(args.tickers, since)
    payload = [s.to_dict() for s in signals]
    print(json.dumps(payload, indent=2, default=str) if args.json else payload)


if __name__ == "__main__":
    main()

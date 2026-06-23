"""
volume_anomaly adapter — Yahoo Finance via yfinance (free, no API key).

Fires when the most recent session's volume is a statistical outlier versus the
ticker's own recent baseline (a volume z-score >= ~3σ). Unusual volume is the
classic "something is brewing" tell — direction is set by whether price rose or
fell on the anomalous-volume day.

Category: PRICE_VOLUME_STRUCTURE.  half_life: 5d  (spec §3 — fast decay).
magnitude rule: the volume z-score mapped into 0..1, saturating around 6σ.

NOTE: this is a PRICE_VOLUME signal, not a narrative signal. Heavy volume that
coincides with heavy news is what the separate crowding penalty exists to
discount — the engine handles that downstream.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from radar_v2.signals.schema import Signal


HALF_LIFE_DAYS = 5
Z_THRESHOLD = 3.0


def _history(ticker: str):
    """Return ~3 months of daily (Close, Volume) tuples, oldest-first, or []."""
    try:
        import yfinance as yf
    except Exception:
        return []
    try:
        hist = yf.Ticker(ticker).history(period="3mo", interval="1d")
        if hist is None or hist.empty:
            return []
        rows = [
            (float(c), float(v))
            for c, v in zip(hist["Close"].values, hist["Volume"].values)
            if v and v > 0
        ]
        return rows
    except Exception:
        return []


def _volume_zscore(rows: list[tuple[float, float]]) -> tuple[float, int] | None:
    """Return (z_score, direction) for the latest session vs the prior baseline.

    direction: +1 if the latest close rose vs the prior close, else -1.
    Needs at least ~21 sessions of baseline.
    """
    if len(rows) < 22:
        return None
    closes = [c for c, _ in rows]
    volumes = [v for _, v in rows]
    latest_vol = volumes[-1]
    baseline = volumes[:-1][-21:]  # prior 21 sessions
    mean = sum(baseline) / len(baseline)
    var = sum((v - mean) ** 2 for v in baseline) / len(baseline)
    std = var ** 0.5
    if std <= 0:
        return None
    z = (latest_vol - mean) / std
    direction = 1 if closes[-1] >= closes[-2] else -1
    return z, direction


def signal_for_ticker(ticker: str, rows: list[tuple[float, float]], now: datetime | None = None) -> list[Signal]:
    now = now or datetime.now(timezone.utc)
    result = _volume_zscore(rows)
    if result is None:
        return []
    z, direction = result
    if z < Z_THRESHOLD:
        return []
    magnitude = min(1.0, z / 6.0)  # 6σ saturates to 1.0
    sig = Signal(
        ticker=ticker.upper(),
        signal_type="volume_anomaly",
        category="PRICE_VOLUME_STRUCTURE",
        direction=direction,
        magnitude=round(magnitude, 6),
        confidence=0.65,
        event_time=now,
        half_life_days=HALF_LIFE_DAYS,
        source_url=f"https://finance.yahoo.com/quote/{ticker.upper()}",
        evidence=f"${ticker.upper()} traded {z:.1f}σ above its 21-day average volume on the latest session.",
        raw={"volume_zscore": z},
    )
    sig.validate()
    return [sig]


def fetch(tickers: list[str] | None, since: datetime) -> list[Signal]:
    if not tickers:
        return []
    out: list[Signal] = []
    for ticker in tickers:
        try:
            out.extend(signal_for_ticker(ticker, _history(ticker)))
        except Exception as exc:
            print(f"[radar_v2.volume_anomaly] warning {ticker}: {exc}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 volume_anomaly adapter (yfinance)")
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

"""
news_velocity adapter — free RSS (no API key).

Counts recent headlines for a ticker from a free RSS feed and turns the count
into a low-weight NARRATIVE_SENTIMENT signal. Per the house rule (spec §4.3 and
roadmap compliance #4), NARRATIVE is hard-capped at weight 0.04 in the engine —
"stories follow signals, not vice versa." This adapter therefore mostly exists
to (a) populate the narrative slot and (b) feed the crowding penalty later.

Category: NARRATIVE_SENTIMENT.  half_life: 3d  (spec §3 — very fast decay).
direction: +1 (presence of coverage; sentiment classification is deferred — the
engine caps this category's weight so a wrong sign barely matters).
magnitude rule: headline count scaled, saturating around 20 headlines/window.

Source: Yahoo Finance per-ticker RSS (free). Returns [] on any error.
"""

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

from radar_v2.signals.adapters._http import DEFAULT_HEADERS
from radar_v2.signals.schema import Signal


HALF_LIFE_DAYS = 3
RSS_URL = "https://feeds.finance.yahoo.com/rss/2.0/headline"


def _headline_count(ticker: str) -> int:
    """Count headlines in the ticker's Yahoo Finance RSS feed, or 0 on error."""
    try:
        resp = requests.get(
            RSS_URL,
            params={"s": ticker, "region": "US", "lang": "en-US"},
            headers={**DEFAULT_HEADERS, "Accept": "application/rss+xml, application/xml"},
            timeout=20,
        )
        if not resp.ok:
            return 0
        root = ET.fromstring(resp.content)
        return len(root.findall(".//item"))
    except Exception:
        return 0


def signal_for_ticker(ticker: str, headline_count: int, now: datetime | None = None) -> list[Signal]:
    now = now or datetime.now(timezone.utc)
    if headline_count <= 0:
        return []
    magnitude = min(1.0, headline_count / 20.0)  # 20 headlines saturates to 1.0
    sig = Signal(
        ticker=ticker.upper(),
        signal_type="news_velocity",
        category="NARRATIVE_SENTIMENT",
        direction=1,
        magnitude=round(magnitude, 6),
        confidence=0.5,
        event_time=now,
        half_life_days=HALF_LIFE_DAYS,
        source_url=f"https://finance.yahoo.com/quote/{ticker.upper()}/news",
        evidence=f"${ticker.upper()} has {headline_count} recent news headline(s) in its feed.",
        raw={"headline_count": headline_count},
    )
    sig.validate()
    return [sig]


def fetch(tickers: list[str] | None, since: datetime) -> list[Signal]:
    if not tickers:
        return []
    out: list[Signal] = []
    for ticker in tickers:
        try:
            out.extend(signal_for_ticker(ticker, _headline_count(ticker)))
        except Exception as exc:
            print(f"[radar_v2.news_rss] warning {ticker}: {exc}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 news_velocity adapter (RSS)")
    parser.add_argument("--tickers", nargs="+", required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    signals = fetch(args.tickers, since)
    payload = [s.to_dict() for s in signals]
    print(json.dumps(payload, indent=2, default=str) if args.json else payload)


if __name__ == "__main__":
    main()

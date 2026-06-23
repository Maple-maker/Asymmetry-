"""
gov_contract_award adapter — USAspending.gov (free, no API key).

USAspending exposes a public POST search API for federal award data. We look up
recent contract awards by recipient (company) name and emit one
``gov_contract_award`` Signal per ticker that had award activity in the window.

Category: GOVERNMENT_REGULATORY.  half_life: 21d  (spec §3).
magnitude rule (spec §3): award $ scaled toward market cap. We do not have a
market-cap feed wired in M4, so we use a documented fallback: log-scale the
total award dollars (a $100M+ award saturates to ~1.0). The raw award dollars
are kept in ``raw`` so the council/UI can audit the real number.

Ticker -> company name is resolved via SEC's free company_tickers.json (the same
file the SEC adapters already use). Network errors return [] (adapter contract).
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from radar_v2.signals.adapters._http import get_json, post_json
from radar_v2.signals.schema import Signal


SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
HALF_LIFE_DAYS = 21

_NAME_MAP: dict[str, str] = {}


def _load_company_names() -> None:
    """Build ticker -> company title map from SEC's free file (lazy, cached)."""
    global _NAME_MAP
    if _NAME_MAP:
        return
    data = get_json(COMPANY_TICKERS_URL)
    if not data:
        return
    _NAME_MAP = {
        str(v["ticker"]).upper(): str(v.get("title", "")).strip()
        for v in data.values()
        if v.get("ticker")
    }


def _company_name(ticker: str) -> str | None:
    _load_company_names()
    return _NAME_MAP.get(ticker.upper())


def _magnitude_from_dollars(total_usd: float) -> float:
    """Documented fallback magnitude: log-scale award dollars into 0..1.

    ~$1M -> ~0.3, ~$10M -> ~0.6, ~$100M+ -> ~1.0. Replace with award/market_cap
    once a market-cap feed lands (M5).
    """
    import math

    if total_usd <= 0:
        return 0.0
    # log10($) mapped so 1e6 -> 0.3-ish, 1e8 -> 1.0
    scaled = (math.log10(total_usd) - 5.0) / 3.0
    return max(0.0, min(1.0, scaled))


def _awards_for_name(company_name: str, since: datetime) -> list[dict]:
    """Query USAspending for contract awards to a recipient in the window."""
    body = {
        "filters": {
            "recipient_search_text": [company_name],
            "award_type_codes": ["A", "B", "C", "D"],  # contract award types
            "time_period": [
                {"start_date": since.strftime("%Y-%m-%d"), "end_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
            ],
        },
        "fields": ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Start Date"],
        "page": 1,
        "limit": 25,
        "sort": "Award Amount",
        "order": "desc",
    }
    data = post_json(SEARCH_URL, json_body=body)
    if not data:
        return []
    return data.get("results", []) or []


def signals_from_awards(ticker: str, awards: list[dict], now: datetime | None = None) -> list[Signal]:
    """Aggregate a ticker's awards in the window into one Signal."""
    now = now or datetime.now(timezone.utc)
    if not awards:
        return []
    total_usd = sum(float(a.get("Award Amount") or 0) for a in awards)
    if total_usd <= 0:
        return []
    top = awards[0]
    agency = str(top.get("Awarding Agency", "a federal agency"))
    sig = Signal(
        ticker=ticker.upper(),
        signal_type="gov_contract_award",
        category="GOVERNMENT_REGULATORY",
        direction=1,
        magnitude=round(_magnitude_from_dollars(total_usd), 6),
        confidence=0.85,
        event_time=now,  # USAspending lacks a clean public-disclosure timestamp; use scan time
        half_life_days=HALF_LIFE_DAYS,
        source_url=f"https://www.usaspending.gov/search/?hash=&recipient={ticker}",
        evidence=f"${ticker.upper()} received {len(awards)} federal contract award(s) totaling ${total_usd:,.0f} (top awarder: {agency}).",
        raw={"awards": awards, "total_usd": total_usd},
    )
    sig.validate()
    return [sig]


def fetch(tickers: list[str] | None, since: datetime) -> list[Signal]:
    if not tickers:
        return []
    out: list[Signal] = []
    for ticker in tickers:
        try:
            name = _company_name(ticker)
            if not name:
                continue
            awards = _awards_for_name(name, since)
            out.extend(signals_from_awards(ticker, awards))
        except Exception as exc:
            print(f"[radar_v2.usaspending] warning {ticker}: {exc}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 USAspending gov-contract adapter")
    parser.add_argument("--tickers", nargs="+", required=True)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    signals = fetch(args.tickers, since)
    payload = [s.to_dict() for s in signals]
    print(json.dumps(payload, indent=2, default=str) if args.json else payload)


if __name__ == "__main__":
    main()

"""
fda_decision adapter — openFDA (free, no API key required).

openFDA exposes free drug/device endpoints. We query recent drug-application
submissions for a sponsor (company) name and emit a GOVERNMENT_REGULATORY
signal when there is recent FDA activity. This is most relevant to biotech/
pharma tickers; for non-pharma names it simply returns no signal.

Category: GOVERNMENT_REGULATORY.  half_life: 14d  (spec §3 — fda_decision).
direction: +1 (an approval/submission is a bullish catalyst; CRLs etc. would be
bearish but are not reliably exposed via this free endpoint — kept simple for M4).
magnitude rule: count of recent submissions scaled, saturating at ~5.

Ticker -> sponsor name uses SEC's free company_tickers.json. Returns [] on error.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from radar_v2.signals.adapters._http import get_json
from radar_v2.signals.schema import Signal


DRUGSFDA_URL = "https://api.fda.gov/drug/drugsfda.json"
COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
HALF_LIFE_DAYS = 14

_NAME_MAP: dict[str, str] = {}


def _load_company_names() -> None:
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


def _fda_submissions(sponsor_name: str) -> list[dict]:
    """Query openFDA drugsfda for a sponsor's applications, or [] on error."""
    # openFDA search syntax: sponsor_name field, exact-ish phrase match.
    safe = sponsor_name.replace('"', "").split(",")[0].strip()
    if not safe:
        return []
    params = {"search": f'sponsor_name:"{safe}"', "limit": 10}
    data = get_json(DRUGSFDA_URL, params=params)
    if not data:
        return []
    return data.get("results", []) or []


def signals_from_results(ticker: str, results: list[dict], now: datetime | None = None) -> list[Signal]:
    now = now or datetime.now(timezone.utc)
    if not results:
        return []
    # Count total submissions across returned applications as activity proxy.
    submission_count = sum(len(r.get("submissions", []) or []) for r in results)
    if submission_count <= 0:
        return []
    magnitude = min(1.0, submission_count / 5.0)
    app_no = results[0].get("application_number", "")
    sig = Signal(
        ticker=ticker.upper(),
        signal_type="fda_decision",
        category="GOVERNMENT_REGULATORY",
        direction=1,
        magnitude=round(magnitude, 6),
        confidence=0.6,
        event_time=now,  # free endpoint lacks a clean per-event public timestamp
        half_life_days=HALF_LIFE_DAYS,
        source_url=f"https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo={app_no}",
        evidence=f"${ticker.upper()} has {submission_count} FDA drug-application submission(s) on file with openFDA.",
        raw={"application_count": len(results), "submission_count": submission_count},
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
            out.extend(signals_from_results(ticker, _fda_submissions(name)))
        except Exception as exc:
            print(f"[radar_v2.openfda] warning {ticker}: {exc}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 openFDA adapter (free)")
    parser.add_argument("--tickers", nargs="+", required=True)
    parser.add_argument("--days", type=int, default=60)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    signals = fetch(args.tickers, since)
    payload = [s.to_dict() for s in signals]
    print(json.dumps(payload, indent=2, default=str) if args.json else payload)


if __name__ == "__main__":
    main()

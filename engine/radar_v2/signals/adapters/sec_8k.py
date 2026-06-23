import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Callable

from radar_v2.signals.schema import Signal


HALF_LIFE_DAYS = 10


def _import_legacy_scan():
    # The legacy SEC EDGAR scraper now lives inside the package (radar_v2/legacy/).
    # (Ported from No-Fomo, where it was imported via a sys.path hack into ../backend.)
    from radar_v2.legacy.sec_scanner import scan

    return scan


def _event_time(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    normalized = value.replace("Z", "+00:00")
    if "T" not in normalized:
        normalized = f"{normalized}T00:00:00+00:00"
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _category(raw_category: str) -> str:
    text = raw_category.lower()
    if any(term in text for term in ("government", "fda", "regulatory", "faa", "fcc", "nrc")):
        return "GOVERNMENT_REGULATORY"
    if any(term in text for term in ("partnership", "contract", "m&a", "supply", "offtake")):
        return "COMMERCIAL_DEALS"
    if any(term in text for term in ("financing", "corporate", "restructuring", "spin")):
        return "FUNDAMENTALS_INFLECTION"
    return "COMMERCIAL_DEALS"


def signals_from_filings(filings: list[dict]) -> list[Signal]:
    signals: list[Signal] = []
    for filing in filings:
        ticker = str(filing.get("ticker", "")).upper()
        if not ticker:
            continue
        category_text = str(filing.get("category", "material event"))
        matched = str(filing.get("matched", filing.get("form_type", "material item")))
        sig = Signal(
            ticker=ticker,
            signal_type="sec_8k_material",
            category=_category(category_text),
            direction=1,
            magnitude=0.7 if filing.get("form_type") in ("8-K", "8-K/A") else 0.45,
            confidence=0.88,
            event_time=_event_time(str(filing.get("filed_at", ""))),
            half_life_days=HALF_LIFE_DAYS,
            source_url=str(filing.get("filing_url", "")),
            evidence=f"${ticker} filed an {filing.get('form_type', 'SEC filing')} tied to {category_text}: {matched}.",
            raw=filing,
        )
        sig.validate()
        signals.append(sig)
    return signals


def fetch(
    tickers: list[str] | None,
    since: datetime,
    scan_func: Callable[[list[str] | None, int], list[dict]] | None = None,
) -> list[Signal]:
    days = max(1, (datetime.now(timezone.utc) - since.astimezone(timezone.utc)).days)
    scanner = scan_func or _import_legacy_scan()
    try:
        return signals_from_filings(scanner(tickers=tickers, days=days))
    except Exception as exc:
        print(f"[radar_v2.sec_8k] warning: {exc}", file=sys.stderr)
        return []


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 SEC 8-K adapter")
    parser.add_argument("--tickers", nargs="*")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    signals = fetch(args.tickers, since)
    payload = [s.to_dict() for s in signals]
    print(json.dumps(payload, indent=2, default=str) if args.json else payload)


if __name__ == "__main__":
    main()

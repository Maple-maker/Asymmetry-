import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Callable

from radar_v2.signals.schema import Signal


def _import_legacy_scan():
    # The legacy SEC Form 4 scraper now lives inside the package (radar_v2/legacy/).
    # (Ported from No-Fomo, where it was imported via a sys.path hack into ../backend.)
    from radar_v2.legacy.insider_scraper import scan

    return scan


def _event_time(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    normalized = value.replace("Z", "+00:00").replace("/", "-")
    if "T" not in normalized:
        normalized = f"{normalized}T00:00:00+00:00"
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def signals_from_scan_results(results: list[dict]) -> list[Signal]:
    signals: list[Signal] = []
    for result in results:
        ticker = str(result.get("ticker", "")).upper()
        transactions = result.get("transactions", [])
        buys = [t for t in transactions if t.get("code") == "P" and not t.get("is_10b5_1")]
        sells = [t for t in transactions if t.get("code") == "S" and not t.get("is_10b5_1")]

        if len(buys) >= 2:
            total_buy_usd = sum(float(t.get("value") or 0) for t in buys)
            distinct_insiders = len({str(t.get("filer", "")).strip() for t in buys if t.get("filer")})
            magnitude = min(1.0, total_buy_usd / 1_000_000) * min(1.0, distinct_insiders / 3)
            source_url = str(buys[0].get("filing_url") or result.get("filing_url") or "")
            sig = Signal(
                ticker=ticker,
                signal_type="insider_cluster_buy",
                category="INSIDER_SMART_MONEY",
                direction=1,
                magnitude=round(magnitude, 6),
                confidence=0.9,
                event_time=_event_time(str(buys[0].get("date") or buys[0].get("filed_at") or "")),
                half_life_days=30,
                source_url=source_url,
                evidence=f"${ticker} had {len(buys)} open-market insider buys totaling ${total_buy_usd:,.0f}.",
                raw={"transactions": buys},
            )
            sig.validate()
            signals.append(sig)

        if sells:
            total_sell_usd = sum(float(t.get("value") or 0) for t in sells)
            source_url = str(sells[0].get("filing_url") or result.get("filing_url") or "")
            sig = Signal(
                ticker=ticker,
                signal_type="insider_sale_unplanned",
                category="INSIDER_SMART_MONEY",
                direction=-1,
                magnitude=min(1.0, total_sell_usd / 1_000_000),
                confidence=0.75,
                event_time=_event_time(str(sells[0].get("date") or sells[0].get("filed_at") or "")),
                half_life_days=30,
                source_url=source_url,
                evidence=f"${ticker} had unplanned insider sales totaling ${total_sell_usd:,.0f}.",
                raw={"transactions": sells},
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
        return signals_from_scan_results(scanner(tickers=tickers, days=days))
    except Exception as exc:
        print(f"[radar_v2.form4_insider] warning: {exc}", file=sys.stderr)
        return []


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 Form 4 adapter")
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

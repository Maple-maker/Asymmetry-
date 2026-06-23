import argparse
import json
from datetime import datetime, timedelta, timezone
from typing import Callable

from radar_v2.engine.score import score_ticker
from radar_v2.signals.adapters import (
    form4_insider,
    momentum,
    news_rss,
    openfda,
    regime_macro,
    sec_8k,
    short_interest,
    usaspending,
    volume_anomaly,
)
from radar_v2.signals.schema import Signal


AdapterFetcher = Callable[[list[str] | None, datetime], list[Signal]]

# The two SEC adapters are the proven, fully-network-tested default.
DEFAULT_ADAPTERS: list[AdapterFetcher] = [sec_8k.fetch, form4_insider.fetch]

# All M4 free-source adapters (used with --full). Each emits valid Signals,
# returns [] on network error, and needs no FMP/Finnhub key.
FULL_ADAPTERS: list[AdapterFetcher] = [
    sec_8k.fetch,
    form4_insider.fetch,
    usaspending.fetch,
    short_interest.fetch,
    momentum.fetch,
    volume_anomaly.fetch,
    openfda.fetch,
    news_rss.fetch,
    regime_macro.fetch,
]


def run_scan(
    tickers: list[str],
    *,
    now: datetime | None = None,
    since: datetime | None = None,
    adapter_fetchers: list[AdapterFetcher] | None = None,
    dry_run: bool = True,
) -> dict:
    now = now or datetime.now(timezone.utc)
    since = since or now - timedelta(days=30)
    adapter_fetchers = adapter_fetchers or DEFAULT_ADAPTERS

    all_signals: list[Signal] = []
    for fetcher in adapter_fetchers:
        all_signals.extend(fetcher(tickers, since))

    results = []
    for ticker in tickers:
        ticker_signals = [sig for sig in all_signals if sig.ticker.upper() == ticker.upper()]
        results.append(score_ticker(ticker, ticker_signals, now=now))

    # --- Supabase write seam (M4 DoD) -------------------------------------
    # COMPLIANCE: the >=75 gate inside score_ticker() has already run, so any
    # AI/Council call (M5) would happen AFTER this point — never before.
    # When dry_run is True we never persist. When dry_run is False we hand the
    # scored results to the writer, which is itself a no-op unless Supabase
    # credentials are present in the environment (see supabase_writer.py).
    if not dry_run:
        from radar_v2 import supabase_writer

        persisted = supabase_writer.write_results(results, as_of=now)
        return {"dry_run": dry_run, "results": results, "persisted": persisted}

    return {"dry_run": dry_run, "results": results}


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAR V2 scanner")
    parser.add_argument("--tickers", nargs="+", required=True)
    parser.add_argument("--days", type=int, default=30)
    # Default to dry-run (no DB write). Pass --write to actually persist.
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument(
        "--write",
        dest="dry_run",
        action="store_false",
        help="Persist scored results to Supabase (no-op without credentials).",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run ALL M4 free-source adapters, not just the two SEC adapters.",
    )
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    result = run_scan(
        args.tickers,
        now=now,
        since=now - timedelta(days=args.days),
        adapter_fetchers=FULL_ADAPTERS if args.full else None,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()

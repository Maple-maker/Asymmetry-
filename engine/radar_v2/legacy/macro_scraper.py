"""
Macro Regime Scraper — free, no API key required.

Pulls slow-moving global macro context from three free sources and distills it
into a single `macro_regime` block the radar's asymmetry layer can consume:

  - World Bank Open Data  defense spend %GDP, real GDP growth   api.worldbank.org
  - IMF DataMapper (WEO)  1-year-ahead real GDP forecast        imf.org/external/datamapper
  - DBnomics aggregator   BIS credit-to-GDP (US), a stress gauge api.db.nomics.world

Why it exists: when the radar surfaces a defense/industrial/commodity play, the
council's asymmetry scorer can cross-reference the macro tailwind (e.g. global
defense spend rising) instead of guessing. See nofomo_external_repo_brief.md §3.

Macro data is slow-moving — run this once daily (cron) and cache the JSON. Do
NOT call it inline during a radar scan; stale-by-days is fine.

Usage:
    python3 backend/macro_scraper.py                # human-readable summary
    python3 backend/macro_scraper.py --json         # JSON block for the pipeline
    python3 backend/macro_scraper.py --country USA --json
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone

import requests

HEADERS = {"User-Agent": "NoFomo Research (nofomo@example.com)", "Accept": "application/json"}
TIMEOUT = 20

# World Bank indicator codes relevant to NoFomo thesis types
WB_DEFENSE_SPEND = "MS.MIL.XPND.GD.ZS"   # Military expenditure, % of GDP
WB_GDP_GROWTH = "NY.GDP.MKTP.KD.ZG"      # Real GDP growth, % annual

# A 0.3 percentage-point band is the noise floor for these slow annual series —
# smaller moves than this are treated as "flat" rather than a real trend.
NOISE_BAND = 0.3


def _classify_trend(values, rising_label, falling_label):
    """Given a newest-first list of numbers, classify direction over the last 3 points.

    Returns rising_label / falling_label / "flat". Defensive against None/short lists.
    """
    pts = [v for v in values if isinstance(v, (int, float))][:3]
    if len(pts) < 2:
        return "flat"
    delta = pts[0] - pts[-1]  # newest minus oldest
    if delta > NOISE_BAND:
        return rising_label
    if delta < -NOISE_BAND:
        return falling_label
    return "flat"


def fetch_world_bank(country, indicator, attempts=3):
    """World Bank Open Data — returns newest-first list of (year, value); [] on failure.

    Endpoint shape: [ {page metadata}, [ {date, value}, ... ] ] sorted newest-first.
    The WB API intermittently returns spurious 400s under load, so retry briefly.
    """
    url = f"https://api.worldbank.org/v2/country/{country}/indicator/{indicator}"
    # mrnev = "most recent N non-empty values", newest-first — skips the null latest year.
    params = {"format": "json", "mrnev": 5}
    for attempt in range(attempts):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            payload = r.json()
            if not isinstance(payload, list) or len(payload) < 2 or payload[1] is None:
                return []
            # Keep (year, value) for the latest non-null observations, newest-first.
            return [(row.get("date"), row.get("value")) for row in payload[1]]
        except (requests.RequestException, ValueError) as e:
            if attempt < attempts - 1:
                time.sleep(1.5)
                continue
            print(f"[macro] World Bank {indicator} failed after {attempts} tries: {e}", file=sys.stderr)
            return []


def fetch_imf_gdp_forecast(country, target_year):
    """IMF WEO real GDP growth forecast (NGDP_RPCH) for a single year. None on failure."""
    url = f"https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/{country}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        series = r.json().get("values", {}).get("NGDP_RPCH", {}).get(country, {})
        val = series.get(str(target_year))
        return float(val) if val is not None else None
    except (requests.RequestException, ValueError, TypeError) as e:
        print(f"[macro] IMF WEO {country} failed: {e}", file=sys.stderr)
        return None


def fetch_dbnomics_bis_gap():
    """DBnomics → BIS credit-to-GDP GAP for the US (actual minus HP-filter trend). None on failure.

    Series: BIS/WS_CREDIT_GAP/Q.US.P.A.C (US private non-financial sector).
    The gap is the Basel III early-warning gauge: a positive, widening gap means
    credit is running above trend (building systemic risk); negative means the
    system is deleveraging (low stress). ~10 is the classic amber threshold.
    """
    url = "https://api.db.nomics.world/v22/series/BIS/WS_CREDIT_GAP/Q.US.P.A.C"
    try:
        r = requests.get(url, params={"observations": "true"}, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        docs = r.json().get("series", {}).get("docs", [])
        if not docs:
            return None
        values = [v for v in docs[0].get("value", []) if isinstance(v, (int, float))]
        return float(values[-1]) if values else None
    except (requests.RequestException, ValueError, IndexError) as e:
        print(f"[macro] DBnomics BIS failed: {e}", file=sys.stderr)
        return None


def _regime(global_gdp_trend, us_forecast, credit_gap):
    """Coarse regime label from the signals we have.

    NOTE: this is a heuristic. A full read needs an inflation series (not yet wired),
    so "stagflation" here means "growth stalling" rather than a confirmed price spike.
    """
    growth_ok = (us_forecast is not None and us_forecast >= 2.0) or global_gdp_trend == "accelerating"
    growth_weak = (us_forecast is not None and us_forecast < 1.0) or global_gdp_trend == "decelerating"
    high_leverage = credit_gap is not None and credit_gap >= 10.0  # Basel III amber: gap >~10 = systemic risk

    if growth_ok and not high_leverage:
        return "goldilocks"
    if growth_ok and high_leverage:
        return "risk_on"
    if growth_weak and high_leverage:
        return "risk_off"
    if growth_weak:
        return "stagflation"
    return "risk_on"


def build_macro_regime(country="USA"):
    """Pull all three sources and assemble the output schema. Degrades gracefully."""
    next_year = datetime.now(timezone.utc).year + 1

    defense_vals = [v for _, v in fetch_world_bank(country, WB_DEFENSE_SPEND)]
    world_gdp_vals = [v for _, v in fetch_world_bank("WLD", WB_GDP_GROWTH)]
    us_forecast = fetch_imf_gdp_forecast(country, next_year)
    credit_gap = fetch_dbnomics_bis_gap()

    global_gdp_trend = _classify_trend(world_gdp_vals, "accelerating", "decelerating")
    defense_trend = _classify_trend(defense_vals, "rising", "falling")

    # Flags the asymmetry scorer / market-brief agent can switch on.
    flags = []
    if defense_trend == "rising":
        flags.append("defense_tailwind")
    if global_gdp_trend == "decelerating":
        flags.append("global_slowdown")
    if credit_gap is not None and credit_gap >= 10.0:
        flags.append("credit_stress")
    if us_forecast is not None and us_forecast >= 2.5:
        flags.append("us_resilient")

    return {
        "macro_regime": _regime(global_gdp_trend, us_forecast, credit_gap),
        "global_gdp_trend": global_gdp_trend,
        "defense_spend_trend": defense_trend,
        "imf_us_gdp_forecast_1y": us_forecast,
        "bis_credit_gap_us": credit_gap,
        "regime_flags": flags,
        "country": country,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="NoFomo macro regime scraper (free, no key)")
    parser.add_argument("--country", default="USA", help="ISO3 country code (default USA)")
    parser.add_argument("--json", action="store_true", help="emit the raw JSON block")
    args = parser.parse_args()

    regime = build_macro_regime(args.country)

    if args.json:
        print(json.dumps(regime, indent=2))
        return

    # Human-readable summary (matches the other scrapers' default mode)
    print(f"\n  MACRO REGIME — {regime['country']}  ({regime['scraped_at'][:10]})")
    print(f"  {'-' * 46}")
    print(f"  Regime:            {regime['macro_regime']}")
    print(f"  Global GDP trend:  {regime['global_gdp_trend']}")
    print(f"  Defense spend:     {regime['defense_spend_trend']}")
    fc = regime["imf_us_gdp_forecast_1y"]
    print(f"  IMF US GDP (+1y):  {fc if fc is not None else 'n/a'}%")
    cg = regime["bis_credit_gap_us"]
    print(f"  BIS credit gap US: {cg if cg is not None else 'n/a'} pp")
    print(f"  Flags:             {', '.join(regime['regime_flags']) or 'none'}\n")


if __name__ == "__main__":
    main()

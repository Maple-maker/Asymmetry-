#!/usr/bin/env python3
"""
Financial Modeling Prep API client.
Provides real stock data for the Asymmetry Opportunity Radar.
Set FMP_API_KEY environment variable before use.
"""

import os
import json
import urllib.request
import urllib.parse
from typing import Any

BASE_URL = "https://financialmodelingprep.com/api"


def _get(endpoint: str, version: str = "v3", **params) -> Any:
    api_key = os.environ.get("FMP_API_KEY")
    if not api_key:
        raise RuntimeError("FMP_API_KEY environment variable not set")
    params["apikey"] = api_key
    qs = urllib.parse.urlencode(params)
    url = f"{BASE_URL}/{version}/{endpoint}?{qs}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        return json.loads(resp.read())


# ── Quote & Price ──────────────────────────────────────────────────────────────

def get_quote(ticker: str) -> dict:
    """Current price, market cap, PE, 52w range."""
    data = _get(f"quote/{ticker.upper()}")
    return data[0] if data else {}


def get_price(ticker: str) -> float:
    q = get_quote(ticker)
    return q.get("price", 0.0)


# ── Financials ─────────────────────────────────────────────────────────────────

def get_income_statement(ticker: str, limit: int = 8) -> list[dict]:
    """Quarterly income statements (last 8 quarters by default)."""
    return _get(f"income-statement/{ticker.upper()}", period="quarter", limit=limit)


def get_balance_sheet(ticker: str, limit: int = 4) -> list[dict]:
    return _get(f"balance-sheet-statement/{ticker.upper()}", period="quarter", limit=limit)


def get_cash_flow(ticker: str, limit: int = 4) -> list[dict]:
    return _get(f"cash-flow-statement/{ticker.upper()}", period="quarter", limit=limit)


def get_financial_ratios(ticker: str) -> dict:
    """TTM ratios: P/S, P/E, P/FCF, EV/EBITDA, gross margin, etc."""
    data = _get(f"ratios-ttm/{ticker.upper()}")
    return data[0] if data else {}


def get_key_metrics(ticker: str) -> dict:
    data = _get(f"key-metrics-ttm/{ticker.upper()}")
    return data[0] if data else {}


# ── Growth ─────────────────────────────────────────────────────────────────────

def get_revenue_growth(ticker: str) -> dict:
    """YoY revenue growth and earnings growth."""
    data = _get(f"financial-growth/{ticker.upper()}", period="annual", limit=1)
    return data[0] if data else {}


# ── Insider Trading ────────────────────────────────────────────────────────────

def get_insider_trades(ticker: str, limit: int = 20) -> list[dict]:
    """Form 4 insider transactions. Check for open-market buys vs sells."""
    return _get(f"insider-trading", symbol=ticker.upper(), limit=limit)


# ── Analyst & Institutional ────────────────────────────────────────────────────

def get_analyst_estimates(ticker: str) -> list[dict]:
    return _get(f"analyst-estimates/{ticker.upper()}", limit=4)


def get_analyst_coverage(ticker: str) -> int:
    """Number of analysts covering the stock (0-3 = underfollowed)."""
    data = _get(f"analyst-stock-recommendations/{ticker.upper()}", limit=20)
    return len(data)


def get_institutional_ownership(ticker: str) -> list[dict]:
    return _get(f"institutional-holder/{ticker.upper()}")


# ── Peers ──────────────────────────────────────────────────────────────────────

def get_peers(ticker: str) -> list[str]:
    data = _get(f"stock_peers", symbol=ticker.upper())
    if data:
        return data[0].get("peersList", [])[:3]
    return []


# ── Contracts & News ───────────────────────────────────────────────────────────

def get_news(ticker: str, limit: int = 10) -> list[dict]:
    return _get(f"stock_news", tickers=ticker.upper(), limit=limit)


def get_sec_filings(ticker: str, type_filter: str = "10-K", limit: int = 5) -> list[dict]:
    return _get(f"sec_filings/{ticker.upper()}", type=type_filter, limit=limit)


# ── Screener ───────────────────────────────────────────────────────────────────

def screen_microcap_opportunities(
    market_cap_max: int = 500_000_000,
    volume_min: int = 50_000,
    country: str = "US",
    limit: int = 50,
) -> list[dict]:
    """
    Screen for underfollowed micro/small-cap stocks for radar scanning.
    Returns companies by market cap ascending (smallest first).
    """
    return _get(
        "stock-screener",
        marketCapMoreThan=1_000_000,
        marketCapLowerThan=market_cap_max,
        volumeMoreThan=volume_min,
        country=country,
        limit=limit,
        sort="marketCap",
        order="asc",
    )


# ── Convenience: Full Radar Snapshot ──────────────────────────────────────────

def get_radar_snapshot(ticker: str) -> dict:
    """
    One call to get everything Claude needs to run the 7-question framework
    and score an opportunity. Assembles data from multiple endpoints.
    """
    t = ticker.upper()
    quote = get_quote(t)
    ratios = get_financial_ratios(t)
    metrics = get_key_metrics(t)
    growth = get_revenue_growth(t)
    insiders = get_insider_trades(t, limit=10)
    analyst_count = get_analyst_coverage(t)
    peers = get_peers(t)
    news = get_news(t, limit=5)

    # Insider signal: net buy/sell in last 10 transactions
    insider_buys = sum(1 for tx in insiders if tx.get("transactionType") == "P-Purchase")
    insider_sells = sum(1 for tx in insiders if tx.get("transactionType") == "S-Sale")

    return {
        "ticker": t,
        "price": quote.get("price"),
        "market_cap": quote.get("marketCap"),
        "pe_ratio": quote.get("pe"),
        "52w_high": quote.get("yearHigh"),
        "52w_low": quote.get("yearLow"),
        "pct_from_52w_high": round(
            (quote.get("price", 0) - quote.get("yearHigh", 1))
            / quote.get("yearHigh", 1) * 100, 1
        ),
        "ps_ttm": ratios.get("priceToSalesRatioTTM"),
        "p_fcf": ratios.get("priceToFreeCashFlowsRatioTTM"),
        "ev_ebitda": ratios.get("enterpriseValueMultipleTTM"),
        "gross_margin": ratios.get("grossProfitMarginTTM"),
        "operating_margin": ratios.get("operatingProfitMarginTTM"),
        "revenue_growth_yoy": growth.get("revenueGrowth"),
        "earnings_growth_yoy": growth.get("netIncomeGrowth"),
        "analyst_count": analyst_count,
        "insider_buys_recent": insider_buys,
        "insider_sells_recent": insider_sells,
        "insider_signal": "BUY" if insider_buys > insider_sells else "SELL" if insider_sells > insider_buys else "NEUTRAL",
        "peers": peers,
        "recent_news_headlines": [n.get("title") for n in news],
        "enterprise_value": metrics.get("enterpriseValueTTM"),
        "revenue_per_share": metrics.get("revenuePerShareTTM"),
        "free_cash_flow_yield": metrics.get("freeCashFlowYieldTTM"),
    }


if __name__ == "__main__":
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    snap = get_radar_snapshot(ticker)
    print(json.dumps(snap, indent=2, default=str))

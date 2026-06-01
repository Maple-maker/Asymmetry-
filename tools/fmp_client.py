#!/usr/bin/env python3
"""
Market data client for the Asymmetry Opportunity Radar.
Uses Yahoo Finance via yfinance — no API key required, covers all tickers.

Install: pip install yfinance
Usage:
  python3 tools/fmp_client.py TICKER
  from tools.fmp_client import get_radar_snapshot
"""

import json
import sys
from typing import Any


def _get_yf(ticker: str):
    try:
        import yfinance as yf
    except ImportError:
        raise RuntimeError("Install yfinance: pip install yfinance")
    return yf.Ticker(ticker.upper())


def get_radar_snapshot(ticker: str) -> dict:
    """
    Fetch live market data for a ticker.
    Returns the full snapshot used by the 7-question framework and scoring rubric.
    """
    t = ticker.upper()
    stock = _get_yf(t)
    info  = stock.info or {}

    price     = info.get("currentPrice") or info.get("regularMarketPrice")
    year_high = info.get("fiftyTwoWeekHigh")
    year_low  = info.get("fiftyTwoWeekLow")
    mcap      = info.get("marketCap")

    # Insider transactions
    buys, sells = 0, 0
    try:
        ins_df = stock.insider_transactions
        if ins_df is not None and not ins_df.empty:
            col = ins_df.get("Text", ins_df.get("text", None))
            if col is not None:
                buys  = int((col.str.contains("Purchase", case=False, na=False)).sum())
                sells = int((col.str.contains("Sale",     case=False, na=False)).sum())
    except Exception:
        pass

    # Analyst count
    analyst_count = info.get("numberOfAnalystOpinions") or 0

    # Recent news headlines
    news = []
    try:
        raw_news = stock.news or []
        news = [n.get("title", "") for n in raw_news[:5]]
    except Exception:
        pass

    # Peer tickers (Yahoo sometimes provides these)
    peers: list[str] = []

    return {
        "ticker":              t,
        "price":               price,
        "market_cap":          mcap,
        "pe_ratio":            info.get("trailingPE"),
        "forward_pe":          info.get("forwardPE"),
        "52w_high":            year_high,
        "52w_low":             year_low,
        "pct_from_52w_high":   round((price - year_high) / year_high * 100, 1)
                               if price and year_high else None,
        "ps_ttm":              info.get("priceToSalesTrailingTwelveMonths"),
        "p_fcf":               None,
        "ev_ebitda":           info.get("enterpriseToEbitda"),
        "gross_margin":        info.get("grossMargins"),
        "operating_margin":    info.get("operatingMargins"),
        "profit_margin":       info.get("profitMargins"),
        "revenue_growth_yoy":  info.get("revenueGrowth"),
        "earnings_growth_yoy": info.get("earningsGrowth"),
        "enterprise_value":    info.get("enterpriseValue"),
        "revenue_per_share":   info.get("revenuePerShare"),
        "free_cash_flow":      info.get("freeCashflow"),
        "total_cash":          info.get("totalCash"),
        "total_debt":          info.get("totalDebt"),
        "debt_to_equity":      info.get("debtToEquity"),
        "current_ratio":       info.get("currentRatio"),
        "beta":                info.get("beta"),
        "analyst_count":       analyst_count,
        "recommendation":      info.get("recommendationKey"),
        "insider_buys_recent":  buys,
        "insider_sells_recent": sells,
        "insider_signal":      "BUY" if buys > sells else "SELL" if sells > buys else "NEUTRAL",
        "peers":               peers,
        "recent_news_headlines": news,
    }


def get_price(ticker: str) -> float:
    snap = get_radar_snapshot(ticker)
    return snap.get("price") or 0.0


def get_peers(ticker: str) -> list[str]:
    """Returns peer tickers — populate manually or extend with a screener."""
    return []


if __name__ == "__main__":
    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    snap   = get_radar_snapshot(ticker)
    print(json.dumps(snap, indent=2, default=str))

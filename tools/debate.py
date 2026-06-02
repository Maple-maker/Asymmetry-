#!/usr/bin/env python3
"""
Multi-model debate: Venice (bull) vs DeepSeek (bear) vs Gemini (synthesis).

Venice  — Kimi K2, web-search enabled. Role: bull advocate with live data.
DeepSeek — V3 or R1. Role: quantitative bear, stress-tests every assumption.
Gemini  — 2.5 Flash. Role: synthesizes the debate into final structured output.

Usage:
  python3 tools/debate.py TICKER
  python3 tools/debate.py TICKER --round1-only    # skip rebuttals
  python3 tools/debate.py TICKER --output report  # save transcript to file

Requires env vars:
  VENICE_API_KEY
  DEEPSEEK_API_KEY
  GEMINI_API_KEY     (optional — for final synthesis)
  FMP_API_KEY        (optional — for live market data)
"""

import sys
import os
import json
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# Adjust path so we can import sibling tools
sys.path.insert(0, os.path.dirname(__file__))
from venice_client import VeniceClient
from deepseek_client import DeepSeekClient


def build_data_block(ticker: str, snap: dict) -> str:
    price = f"${snap['price']}" if snap.get("price") else "N/A"
    mcap  = f"${snap['market_cap'] / 1e6:.0f}M" if snap.get("market_cap") else "N/A"
    rev   = f"{snap['revenue_growth'] * 100:.1f}%" if snap.get("revenue_growth") is not None else "N/A"
    gm    = f"{snap['gross_margin'] * 100:.1f}%" if snap.get("gross_margin") is not None else "N/A"
    ps    = f"{snap['ps_ttm']:.1f}x" if snap.get("ps_ttm") is not None else "N/A"
    ev    = f"{snap['ev_ebitda']:.1f}x" if snap.get("ev_ebitda") is not None else "N/A"
    ins   = f"{snap.get('insider_signal', 'N/A')} ({snap.get('insider_buys', 0)}B/{snap.get('insider_sells', 0)}S)"
    return (
        f"Ticker: ${ticker} | Price: {price} | Market Cap: {mcap} | "
        f"Revenue Growth YoY: {rev} | Gross Margin: {gm} | P/S TTM: {ps} | "
        f"EV/EBITDA: {ev} | Insider Signal: {ins}"
    )


def section(title: str, content: str) -> str:
    line = "═" * 60
    return f"\n{line}\n  {title}\n{line}\n{content}\n"


def run_debate(ticker: str, snap: dict, round1_only: bool = False) -> dict:
    """
    Returns a dict with keys: bull, bear, bull_rebuttal, bear_rebuttal, transcript.
    Any failed call returns "" for that key.
    """
    venice   = VeniceClient()
    deepseek = DeepSeekClient()
    data_block = build_data_block(ticker, snap)

    print(f"\n[debate] Starting Round 1 for ${ticker} ...")

    # ── Round 1: independent cases (parallel) ────────────────────────────────
    results = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {
            pool.submit(venice.bull_case,    ticker, data_block): "bull",
            pool.submit(deepseek.bear_case,  ticker, data_block): "bear",
        }
        for fut in as_completed(futures):
            key = futures[fut]
            try:
                results[key] = fut.result()
                print(f"  ✓ {key} case complete ({len(results[key])} chars)")
            except Exception as e:
                results[key] = ""
                print(f"  ✗ {key} case failed: {e}")

    bull = results.get("bull", "")
    bear = results.get("bear", "")

    # ── Round 2: rebuttals (parallel, only if both R1 calls succeeded) ────────
    bull_rebuttal = ""
    bear_rebuttal = ""

    if not round1_only and bull and bear:
        print(f"\n[debate] Starting Round 2 (rebuttals) for ${ticker} ...")
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {
                pool.submit(venice.bull_rebuttal,    ticker, bear): "bull_rebuttal",
                pool.submit(deepseek.bear_rebuttal,  ticker, bull): "bear_rebuttal",
            }
            for fut in as_completed(futures):
                key = futures[fut]
                try:
                    results[key] = fut.result()
                    print(f"  ✓ {key} complete ({len(results[key])} chars)")
                except Exception as e:
                    results[key] = ""
                    print(f"  ✗ {key} failed: {e}")
        bull_rebuttal = results.get("bull_rebuttal", "")
        bear_rebuttal = results.get("bear_rebuttal", "")

    # ── Build transcript ──────────────────────────────────────────────────────
    parts = []
    if bull:
        parts.append(section("BULL CASE — Venice (Kimi K2, web-search enabled)", bull))
    if bull_rebuttal:
        parts.append(section("BULL REBUTTAL — Venice responding to DeepSeek", bull_rebuttal))
    if bear:
        parts.append(section("BEAR CASE — DeepSeek (quantitative skeptic)", bear))
    if bear_rebuttal:
        parts.append(section("BEAR REBUTTAL — DeepSeek responding to Venice", bear_rebuttal))

    transcript = "".join(parts) if parts else "(debate unavailable — check API keys)"

    return {
        "bull":          bull,
        "bear":          bear,
        "bull_rebuttal": bull_rebuttal,
        "bear_rebuttal": bear_rebuttal,
        "transcript":    transcript,
    }


def main():
    parser = argparse.ArgumentParser(description="Multi-model debate for a ticker")
    parser.add_argument("ticker", help="Stock ticker symbol (e.g. ASTS)")
    parser.add_argument("--round1-only", action="store_true", help="Skip rebuttal round")
    parser.add_argument("--output", help="Save transcript to file (omit extension)")
    args = parser.parse_args()

    ticker = args.ticker.upper()

    # Try to get live data from FMP if available
    snap: dict = {}
    try:
        from fmp_client import get_radar_snapshot
        print(f"[data] Fetching live snapshot for ${ticker} ...")
        snap = get_radar_snapshot(ticker)
        print(f"  Price: ${snap.get('price')} | Market Cap: ${snap.get('market_cap', 0) / 1e6:.0f}M")
    except Exception as e:
        print(f"[data] FMP unavailable ({e}) — proceeding without live data")

    # Run the debate
    result = run_debate(ticker, snap, round1_only=args.round1_only)

    # Print transcript
    header = f"\n{'═' * 60}\n  ${ticker} — MULTI-MODEL DEBATE\n  {datetime.now().strftime('%Y-%m-%d %H:%M')}\n{'═' * 60}"
    print(header)
    print(result["transcript"])

    # Save to file if requested
    if args.output:
        date = datetime.now().strftime("%Y%m%d_%H%M")
        path = f"{args.output}_{ticker}_{date}.txt"
        with open(path, "w") as f:
            f.write(header + "\n")
            f.write(result["transcript"])
            f.write(f"\n\n{'═' * 60}\nFull JSON:\n{json.dumps(result, indent=2)}\n")
        print(f"\n[saved] Transcript written to {path}")


if __name__ == "__main__":
    main()

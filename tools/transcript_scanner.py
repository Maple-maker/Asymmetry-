#!/usr/bin/env python3
"""
Tech Giant Signal Scanner — CLI tool
Monitors earnings calls and public speeches from tech giants,
extracts supply-chain / technology signals, finds small-cap beneficiary companies.

Usage:
  python3 tools/transcript_scanner.py NVDA
  python3 tools/transcript_scanner.py NVDA --add-watchlist
  python3 tools/transcript_scanner.py --list
"""

import os
import sys
import re
import json
import argparse
from typing import Optional
from datetime import datetime

# ---------------------------------------------------------------------------
# Add project root to path so tools/ imports work
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, ROOT_DIR)

from tools.venice_client import VeniceClient

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TECH_GIANTS = {
    "NVDA": "NVIDIA Corporation",
    "AMD":  "Advanced Micro Devices",
    "GOOG": "Alphabet / Google",
    "META": "Meta Platforms",
    "MSFT": "Microsoft",
    "AAPL": "Apple",
    "AMZN": "Amazon",
    "TSLA": "Tesla",
    "QCOM": "Qualcomm",
    "INTC": "Intel",
}

EXCLUDED_TICKERS = set(TECH_GIANTS.keys()) | {"GOOGL"}

WATCHLIST_FILE = os.path.join(ROOT_DIR, "vault", "tech_signal_watchlist.json")

# ---------------------------------------------------------------------------
# Data classes (plain dicts with typed helpers)
# ---------------------------------------------------------------------------

def empty_signal() -> dict:
    return {
        "type": "", "what": "", "quote": "",
        "speaker": "", "beneficiary_type": "", "urgency": "LOW",
    }


def empty_beneficiary() -> dict:
    return {
        "ticker": "", "name": "", "market_cap": "",
        "why": "", "exposure": "", "catalyst": "", "confidence": "MEDIUM",
    }


# ---------------------------------------------------------------------------
# Parsers — mirror the edge function logic exactly
# ---------------------------------------------------------------------------

def parse_signals(text: str) -> list[dict]:
    signals = []
    blocks = text.split("---SIGNAL---")[1:]
    for block in blocks:
        end = block.find("---END---")
        content = block[:end] if end >= 0 else block

        def get(key: str) -> str:
            m = re.search(rf"^{key}:\s*(.+)", content, re.IGNORECASE | re.MULTILINE)
            return m.group(1).strip() if m else ""

        sig = empty_signal()
        sig["type"]             = get("TYPE")
        sig["what"]             = get("WHAT")
        sig["quote"]            = get("QUOTE").strip('"')
        sig["speaker"]          = get("SPEAKER")
        sig["beneficiary_type"] = get("BENEFICIARY_TYPE")
        sig["urgency"]          = get("URGENCY") or "LOW"

        if sig["what"]:
            signals.append(sig)
    return signals


def parse_beneficiaries(text: str) -> list[dict]:
    beneficiaries = []
    blocks = text.split("---COMPANY---")[1:]
    for block in blocks:
        end = block.find("---END---")
        content = block[:end] if end >= 0 else block

        def get(key: str) -> str:
            m = re.search(rf"^{key}:\s*(.+)", content, re.IGNORECASE | re.MULTILINE)
            return m.group(1).strip() if m else ""

        ticker = get("TICKER").upper().replace("$", "").strip()
        if not ticker or ticker in EXCLUDED_TICKERS:
            continue

        b = empty_beneficiary()
        b["ticker"]     = ticker
        b["name"]       = get("NAME")
        b["market_cap"] = get("MARKET_CAP")
        b["why"]        = get("WHY")
        b["exposure"]   = get("EXPOSURE")
        b["catalyst"]   = get("CATALYST")
        b["confidence"] = get("CONFIDENCE") or "MEDIUM"
        beneficiaries.append(b)

    return beneficiaries


# ---------------------------------------------------------------------------
# Prompts — mirrors edge function prompts
# ---------------------------------------------------------------------------

def build_signal_prompt(ticker: str, company: str) -> str:
    return f"""You are an investment signal extractor. Your job is to find what {company} ({ticker}) NEEDS from external suppliers, partners, and smaller companies — NOT what they build themselves.

Search the internet for {company}'s most recent:
- Earnings call transcript (last 2 quarters)
- Investor Day / analyst day presentations
- Executive interviews and public speeches (last 6 months)
- Supply chain disclosures in 10-K/10-Q filings

Focus EXCLUSIVELY on statements where executives signal:
1. External technology or components they are BUYING or want to buy more of
2. Supply chain BOTTLENECKS or capacity constraints from suppliers
3. Partnership NEEDS — types of companies they are actively seeking
4. R&D BETS on external technology that they are funding or evaluating
5. Market opportunities where they are NOT the winner — where smaller specialists win

For each signal, extract EXACTLY this format (do not deviate):

---SIGNAL---
TYPE: [TECHNOLOGY_GAP|SUPPLY_CHAIN|PARTNERSHIP|CAPACITY|R&D_BET]
WHAT: [specific technology, component, or capability they need from external partners]
QUOTE: "[exact executive quote or close paraphrase with attribution]"
SPEAKER: [Name, Title]
BENEFICIARY_TYPE: [specific type of smaller company that would benefit — be precise, e.g. "HBM DRAM manufacturer", "fiber optic transceiver maker", "AI inference chip startup"]
URGENCY: HIGH|MEDIUM|LOW
---END---

Extract 4-8 signals. Prioritize HIGH urgency signals where the need is explicit and the beneficiary type is specific and investable. Skip vague or generic statements.

IMPORTANT: Only surface signals where the beneficiary is a SMALLER EXTERNAL company — not {company} itself, not other tech giants."""


def build_beneficiary_prompt(company: str, signals: list[dict]) -> str:
    signal_list = "\n\n".join(
        f"Signal {i+1} [{s['urgency']}]: {s['what']}\n"
        f"  Beneficiary type: {s['beneficiary_type']}\n"
        f"  Quote: \"{s['quote']}\""
        for i, s in enumerate(signals)
    )
    return f"""You are a small-cap equity researcher. Based on the following signals from {company}'s earnings calls and investor presentations, identify publicly traded companies that directly benefit.

SIGNALS FROM {company.upper()}:
{signal_list}

For each signal, find 1-2 publicly traded companies that are direct, concentrated beneficiaries. Strict criteria:
- Market cap: $50M to $10B
- NOT an S&P 500 member
- Prefer companies with <10 analyst coverage on Yahoo Finance/Bloomberg
- Company must have DIRECT revenue exposure to this theme — not tangential
- Company should NOT be one of the big tech giants: NVDA, AMD, GOOG, GOOGL, META, AAPL, MSFT, AMZN, TSLA, QCOM, INTC

For each company, use EXACTLY this format:

---COMPANY---
TICKER: [exchange ticker symbol]
NAME: [full company name]
MARKET_CAP: [$XM or $XB — current approximate market cap]
WHY: [2-3 sentences connecting this company directly to the signal — cite specific products, contracts, or revenue streams]
EXPOSURE: [estimated % of revenue tied to this theme, or "Primary" / "Significant" / "Growing"]
CATALYST: [specific upcoming event that would confirm the thesis — earnings date, contract award, product launch]
CONFIDENCE: HIGH|MEDIUM|LOW
---END---

Be specific and non-obvious. Ignore crowded trades. Ignore anything that every analyst already knows. Find the overlooked supplier, the niche component maker, the specialist software company that feeds directly into {company}'s stated need."""


# ---------------------------------------------------------------------------
# Watchlist file management
# ---------------------------------------------------------------------------

def load_watchlist() -> list[dict]:
    if not os.path.exists(WATCHLIST_FILE):
        return []
    with open(WATCHLIST_FILE) as f:
        return json.load(f)


def save_watchlist(entries: list[dict]) -> None:
    os.makedirs(os.path.dirname(WATCHLIST_FILE), exist_ok=True)
    with open(WATCHLIST_FILE, "w") as f:
        json.dump(entries, f, indent=2)


def add_to_watchlist(
    ticker: str,
    name: str,
    source_company: str,
    signal_theme: str,
    thesis: str,
    catalyst: str,
    confidence: str,
) -> bool:
    entries  = load_watchlist()
    existing = next((e for e in entries if e.get("ticker") == ticker), None)

    entry = {
        "ticker":         ticker,
        "name":           name,
        "source_company": source_company,
        "signal_theme":   signal_theme,
        "thesis":         thesis[:300],
        "catalyst":       catalyst,
        "confidence":     confidence,
        "added_at":       datetime.utcnow().isoformat(),
        "notes":          f"[Tech Giant Signal] {source_company} → {signal_theme}",
    }

    if existing:
        idx = entries.index(existing)
        entries[idx] = entry
        added = False
    else:
        entries.append(entry)
        added = True

    save_watchlist(entries)
    return added


# ---------------------------------------------------------------------------
# Terminal formatting
# ---------------------------------------------------------------------------

RESET  = "\033[0m"
BOLD   = "\033[1m"
RED    = "\033[91m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
DIM    = "\033[2m"


def color_urgency(urgency: str) -> str:
    if urgency == "HIGH":   return f"{RED}{BOLD}{urgency}{RESET}"
    if urgency == "MEDIUM": return f"{YELLOW}{urgency}{RESET}"
    return f"{DIM}{urgency}{RESET}"


def color_confidence(conf: str) -> str:
    if conf == "HIGH":   return f"{GREEN}{BOLD}{conf}{RESET}"
    if conf == "MEDIUM": return f"{YELLOW}{conf}{RESET}"
    return f"{DIM}{conf}{RESET}"


def print_header(company: str, ticker: str) -> None:
    print()
    print(f"{CYAN}{'━'*60}{RESET}")
    print(f"{BOLD}📡  TECH GIANT SIGNAL SCAN — {company} ({ticker}){RESET}")
    print(f"{CYAN}{'━'*60}{RESET}")
    print()


def print_signals(signals: list[dict]) -> None:
    print(f"{BOLD}SIGNALS EXTRACTED ({len(signals)} total){RESET}")
    print(f"{DIM}{'─'*60}{RESET}")
    for i, s in enumerate(signals, 1):
        print(f"  {BOLD}[{i}] {s['type']}{RESET}  urgency={color_urgency(s['urgency'])}")
        print(f"      WHAT: {s['what']}")
        if s["speaker"]:
            print(f"      WHO:  {s['speaker']}")
        if s["quote"]:
            q = s["quote"][:120] + ("..." if len(s["quote"]) > 120 else "")
            print(f"      QUOTE: \"{q}\"")
        print(f"      BENEFICIARY TYPE: {s['beneficiary_type']}")
        print()


def print_beneficiaries(beneficiaries: list[dict], added: set[str]) -> None:
    if not beneficiaries:
        print(f"{YELLOW}No beneficiary companies identified.{RESET}\n")
        return

    print(f"{BOLD}BENEFICIARY COMPANIES ({len(beneficiaries)} found){RESET}")
    print(f"{DIM}{'─'*60}{RESET}")

    for b in beneficiaries:
        watchlist_tag = f" {GREEN}[ADDED TO WATCHLIST]{RESET}" if b["ticker"] in added else ""
        print(f"  {BOLD}${b['ticker']}{RESET}  {b['name']}  cap={b['market_cap']}  "
              f"confidence={color_confidence(b['confidence'])}{watchlist_tag}")
        print(f"  {DIM}Exposure: {b['exposure']}{RESET}")
        # Wrap thesis at 80 chars
        why = b["why"]
        while len(why) > 80:
            cut = why[:80].rfind(" ")
            if cut < 0:
                cut = 80
            print(f"  {why[:cut]}")
            why = why[cut:].lstrip()
        if why:
            print(f"  {why}")
        print(f"  {CYAN}Catalyst: {b['catalyst']}{RESET}")
        print()


def print_footer(added_to_watchlist: set[str]) -> None:
    if added_to_watchlist:
        print(f"{GREEN}{BOLD}➕ Added to watchlist: {', '.join('$' + t for t in sorted(added_to_watchlist))}{RESET}")
    else:
        print(f"{DIM}No HIGH confidence picks — nothing added to watchlist.{RESET}")
    print()


# ---------------------------------------------------------------------------
# Main scan function
# ---------------------------------------------------------------------------

def scan(
    ticker: str,
    company: str,
    auto_add_watchlist: bool = False,
    verbose: bool = False,
) -> dict:
    venice = VeniceClient()

    print_header(company, ticker)

    # ── Venice call 1: extract signals ─────────────────────────────────────
    print(f"{DIM}[1/3] Extracting signals from {company} earnings calls...{RESET}")
    signal_prompt = build_signal_prompt(ticker, company)
    try:
        raw_signals = venice.chat(signal_prompt, web_search=True, max_tokens=2500)
    except Exception as e:
        print(f"{RED}Venice call 1 failed: {e}{RESET}")
        raw_signals = ""

    signals = parse_signals(raw_signals)

    if verbose and raw_signals:
        print(f"\n{DIM}--- RAW VENICE SIGNAL OUTPUT ---{RESET}")
        print(raw_signals[:800], "..." if len(raw_signals) > 800 else "")
        print()

    print_signals(signals)

    if not signals:
        print(f"{YELLOW}No signals extracted. Venice may have returned unstructured output.{RESET}")
        if verbose and raw_signals:
            print(f"{DIM}Raw output (first 500 chars):{RESET}")
            print(raw_signals[:500])
        return {"signals": [], "beneficiaries": [], "added": []}

    # ── Venice call 2: find beneficiaries ──────────────────────────────────
    print(f"{DIM}[2/3] Searching for beneficiary companies...{RESET}")
    ben_prompt = build_beneficiary_prompt(company, signals)
    try:
        raw_beneficiaries = venice.chat(ben_prompt, web_search=True, max_tokens=2500)
    except Exception as e:
        print(f"{RED}Venice call 2 failed: {e}{RESET}")
        raw_beneficiaries = ""

    beneficiaries = parse_beneficiaries(raw_beneficiaries)

    if verbose and raw_beneficiaries:
        print(f"\n{DIM}--- RAW VENICE BENEFICIARY OUTPUT ---{RESET}")
        print(raw_beneficiaries[:800], "..." if len(raw_beneficiaries) > 800 else "")
        print()

    # ── Add to watchlist ───────────────────────────────────────────────────
    added: set[str] = set()
    if auto_add_watchlist:
        print(f"{DIM}[3/3] Adding HIGH confidence picks to watchlist...{RESET}\n")
        for b in beneficiaries:
            if b["confidence"] == "HIGH":
                matched = next(
                    (s for s in signals
                     if s["beneficiary_type"].lower() in b["name"].lower()
                     or b["why"].lower().startswith(s["what"].lower()[:20])),
                    signals[0] if signals else None,
                )
                theme = matched["what"] if matched else "general signal"
                was_added = add_to_watchlist(
                    ticker=b["ticker"],
                    name=b["name"],
                    source_company=f"{company} ({ticker})",
                    signal_theme=theme,
                    thesis=b["why"],
                    catalyst=b["catalyst"],
                    confidence=b["confidence"],
                )
                if was_added:
                    added.add(b["ticker"])
                    print(f"  {GREEN}✅ Added: ${b['ticker']} — {b['name']}{RESET}")
                else:
                    print(f"  {YELLOW}⟳  Updated: ${b['ticker']} (already in watchlist){RESET}")
    else:
        print(f"{DIM}[3/3] Skipping watchlist (pass --add-watchlist to add HIGH confidence picks){RESET}\n")

    print_beneficiaries(beneficiaries, added)
    print_footer(added)

    return {
        "signals":       signals,
        "beneficiaries": beneficiaries,
        "added":         sorted(added),
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Tech Giant Signal Scanner — find small-cap beneficiaries of tech giant supply chain needs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 tools/transcript_scanner.py NVDA
  python3 tools/transcript_scanner.py AMD --add-watchlist
  python3 tools/transcript_scanner.py --list
        """,
    )
    parser.add_argument(
        "ticker",
        nargs="?",
        help="Tech giant ticker to scan (NVDA, AMD, GOOG, META, MSFT, AAPL, AMZN, TSLA, QCOM, INTC)",
    )
    parser.add_argument(
        "--add-watchlist", "-w",
        action="store_true",
        help="Add HIGH confidence beneficiaries to the local watchlist file",
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List available tech giants to scan",
    )
    parser.add_argument(
        "--show-watchlist",
        action="store_true",
        help="Show current tech signal watchlist",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show raw Venice output",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )

    args = parser.parse_args()

    if args.list:
        print(f"\n{BOLD}Available Tech Giants to Scan:{RESET}")
        for t, name in TECH_GIANTS.items():
            print(f"  {CYAN}{t:6}{RESET}  {name}")
        print()
        return

    if args.show_watchlist:
        entries = load_watchlist()
        if not entries:
            print(f"{YELLOW}Watchlist is empty. Run with --add-watchlist to populate.{RESET}")
            return
        print(f"\n{BOLD}Tech Signal Watchlist ({len(entries)} entries):{RESET}")
        for e in entries:
            print(f"\n  {BOLD}${e['ticker']}{RESET} — {e['name']}")
            print(f"    Source:    {e['source_company']}")
            print(f"    Theme:     {e['signal_theme']}")
            print(f"    Catalyst:  {e['catalyst']}")
            print(f"    Confidence:{color_confidence(e['confidence'])}")
            print(f"    Added:     {e['added_at'][:10]}")
        print()
        return

    if not args.ticker:
        parser.print_help()
        sys.exit(1)

    ticker = args.ticker.upper().strip()
    if ticker not in TECH_GIANTS:
        print(f"{RED}Unknown ticker: {ticker}{RESET}")
        print(f"Supported: {', '.join(TECH_GIANTS.keys())}")
        sys.exit(1)

    company = TECH_GIANTS[ticker]
    result  = scan(
        ticker=ticker,
        company=company,
        auto_add_watchlist=args.add_watchlist,
        verbose=args.verbose,
    )

    if args.json:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

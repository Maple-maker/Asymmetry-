"""
SEC EDGAR Catalyst Scanner — free, no API key required.
Monitors company filings via data.sec.gov/submissions API.
Flags catalyst-relevant 8-Ks, 10-Qs, and other filings.

Rate limit: 10 requests/second. User-Agent header required.

Usage:
    python3 backend/sec_scanner.py                          # scan watchlist tickers
    python3 backend/sec_scanner.py --tickers AAPL MSFT      # specific tickers
    python3 backend/sec_scanner.py --days 30                # look back 30 days
    python3 backend/sec_scanner.py --json                   # JSON output
"""

import argparse
import json
import sys
import time
from datetime import datetime, timedelta

import requests

USER_AGENT = "NoFomo Research (nofomo@example.com)"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}

# Ticker → CIK mapping (loaded lazily from SEC)
_CIK_MAP: dict[str, str] = {}

# Default radar watchlist — companies worth monitoring for catalysts
DEFAULT_TICKERS = [
    # Defense / autonomy
    "PLTR", "ANDR", "KTOS", "AVAV", "LDOS",
    # Semis / AI infra
    "NVDA", "AMD", "AVGO", "MRVL", "SMCI",
    # Energy / grid / nuclear
    "CEG", "VST", "TLN", "SMR", "OKLO",
    # Biotech catalysts
    "CRVO", "RXRX", "ABCL",
    # Bitcoin treasury
    "MSTR", "COIN", "RIOT", "CLSK",
    # Materials / lithium
    "ALB", "SQM", "MP",
    # Space
    "RKLB", "LUNR", "RDW",
    # Fintech / platforms
    "HOOD", "SOFI", "AFRM",
]

# Form types that can carry catalysts
CATALYST_FORMS = {"8-K", "8-K/A", "10-Q", "10-K", "S-1", "S-1/A", "S-3", "S-4", "425", "6-K"}

# Keywords in filing descriptions that signal a catalyst
CATALYST_ITEMS = {
    "entry into a material definitive agreement": "partnership/contract",
    "material definitive agreement": "partnership/contract",
    "merger agreement": "M&A",
    "acquisition": "M&A",
    "government contract": "government contract",
    "contract award": "government contract",
    "FDA": "FDA/regulatory",
    "approval": "FDA/regulatory",
    "clearance": "FDA/regulatory",
    "license": "partnership/contract",
    "strategic": "corporate action",
    "restructuring": "corporate action",
    "spin-off": "corporate action",
    "separation": "corporate action",
    "supply agreement": "partnership/contract",
    "offtake": "partnership/contract",
    "loan": "financing",
    "financing": "financing",
    "offering": "financing",
    "patent": "IP/technology",
    "breakthrough": "IP/technology",
    "DOE": "government contract",
    "DoD": "government contract",
    "DARPA": "government contract",
    "IDIQ": "government contract",
    "CE mark": "FDA/regulatory",
    "CE mark": "FDA/regulatory",
    "NRC": "FDA/regulatory",
    "FAA": "FDA/regulatory",
    "FCC": "FDA/regulatory",
}


def _load_cik_map():
    """Load SEC company_tickers.json to map ticker → CIK."""
    global _CIK_MAP
    if _CIK_MAP:
        return
    url = "https://www.sec.gov/files/company_tickers.json"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        if resp.ok:
            data = resp.json()
            _CIK_MAP = {
                v["ticker"].upper(): str(v["cik_str"]).zfill(10)
                for v in data.values()
            }
    except Exception:
        pass  # Will fall back to manual lookups


def _cik_for_ticker(ticker: str) -> str | None:
    """Get CIK for a ticker."""
    _load_cik_map()
    return _CIK_MAP.get(ticker.upper())


def get_recent_filings(ticker: str, days: int = 14) -> list[dict]:
    """Fetch recent filings for a ticker from SEC submissions API."""
    cik = _cik_for_ticker(ticker)
    if not cik:
        return []

    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    resp = requests.get(url, headers=HEADERS, timeout=30)
    if not resp.ok:
        return []

    data = resp.json()
    recent = data.get("filings", {}).get("recent", {})
    if not recent:
        return []

    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    descriptions = recent.get("primaryDocument", [])
    items = recent.get("items", [])  # 8-K item numbers
    accessions = recent.get("accessionNumber", [])

    filings = []
    for i in range(len(forms)):
        if dates[i] < cutoff:
            continue
        form_type = forms[i].upper().strip()
        filings.append({
            "ticker": ticker.upper(),
            "cik": cik,
            "form_type": form_type,
            "filed_at": dates[i],
            "description": descriptions[i] if i < len(descriptions) else "",
            "items": items[i] if i < len(items) else "",
            "accession": accessions[i] if i < len(accessions) else "",
            "filing_url": _build_url(cik, accessions[i]) if i < len(accessions) else "",
        })

    return filings


def flag_catalyst(filing: dict) -> tuple[bool, str, str]:
    """Check if a filing signals a catalyst. Returns (is_catalyst, category, match)."""
    form = filing["form_type"]
    desc = filing.get("description", "").lower()
    items_str = filing.get("items", "").lower()

    # Check form type first
    if form not in CATALYST_FORMS:
        return False, "", ""

    # Check items (8-K items like "1.01" = entry into material agreement)
    for keyword, category in CATALYST_ITEMS.items():
        if keyword in desc or keyword in items_str:
            return True, category, keyword

    # Certain 8-K items are always catalysts
    catalyst_items = {"1.01", "1.02", "1.03", "2.01", "2.03", "3.01", "3.02",
                      "4.01", "4.02", "5.01", "5.02", "5.03", "5.07", "7.01", "8.01", "9.01"}
    for item in catalyst_items:
        if item in items_str:
            return True, "corporate event", f"Item {item}"

    return False, "", ""


def scan(tickers: list[str] | None = None, days: int = 14) -> list[dict]:
    """Scan tickers for recent catalyst filings."""
    if tickers is None:
        tickers = DEFAULT_TICKERS

    all_filings = []
    print(f"🔎 Scanning {len(tickers)} tickers over {days} days…", file=sys.stderr)

    for ticker in tickers:
        try:
            filings = get_recent_filings(ticker, days=days)
            for f in filings:
                is_cat, category, match = flag_catalyst(f)
                if is_cat:
                    f["catalyst"] = True
                    f["category"] = category
                    f["matched"] = match
                    all_filings.append(f)
            time.sleep(0.12)  # ~8 req/s, safe under 10/s limit
        except Exception as e:
            print(f"  ⚠️ {ticker}: {e}", file=sys.stderr)

    all_filings.sort(key=lambda f: f["filed_at"], reverse=True)
    return all_filings


def _build_url(cik: str, accession: str) -> str:
    """Build SEC filing link."""
    acc_clean = accession.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{acc_clean}/{accession}-index.htm"


def format_terminal(filings: list[dict]) -> str:
    """Pretty-print results."""
    if not filings:
        return "No catalyst filings found in this window."

    lines = [f"\n🔍 SEC Catalyst Scan — {len(filings)} filings found\n"]
    for f in filings[:40]:
        lines.append(
            f"  ${f['ticker']:<6} {f['form_type']:<8} {f['category']:<22} {f['filed_at']}   {f['matched']}"
        )
        if f.get("filing_url"):
            lines.append(f"           {f['filing_url']}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="SEC EDGAR Catalyst Scanner")
    parser.add_argument("--tickers", nargs="*", help="Ticker symbols to scan")
    parser.add_argument("--days", type=int, default=14, help="Days back to scan (default: 14)")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    tickers = args.tickers if args.tickers else DEFAULT_TICKERS
    hits = scan(tickers=tickers, days=args.days)

    if args.json:
        print(json.dumps(hits, indent=2, default=str))
    else:
        print(format_terminal(hits))


if __name__ == "__main__":
    main()

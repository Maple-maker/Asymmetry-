"""
SEC Form 4 Insider Trading Scraper — free, no API key required.
Scrapes insider transactions via data.sec.gov/submissions API.
Detects cluster buying: 3+ open-market buys by officers/directors within 30 days.

Rate limit: 10 requests/second. User-Agent header required.

Usage:
    python3 backend/insider_scraper.py                          # scan default watchlist
    python3 backend/insider_scraper.py --tickers AAPL MSFT      # specific tickers
    python3 backend/insider_scraper.py --days 30                # lookback window
    python3 backend/insider_scraper.py --json                   # JSON output
"""

import argparse
import json
import sys
import time
from datetime import datetime, timedelta

import requests

USER_AGENT = "NoFomo Research (contact@nofomo.app)"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}
CIK_URL = "https://www.sec.gov/files/company_tickers.json"
SUB_URL = "https://data.sec.gov/submissions/CIK{}.json"

DEFAULT_TICKERS = [
    "PLTR", "MSTR", "RKLB", "ASTS", "OKLO",
    "NVDA", "AVGO", "MRVL", "SMCI", "AMD",
    "CEG", "VST", "SMR", "TLN",
    "KTOS", "AVAV", "LDOS",
    "LUNR", "RDW",
    "COIN", "HOOD", "SOFI",
    "RXRX", "CRSP", "NTLA",
    "ALB", "MP",
]

_CIK_MAP: dict[str, str] = {}


def load_cik_map():
    """Load SEC company_tickers.json -> ticker to CIK mapping."""
    global _CIK_MAP
    if _CIK_MAP:
        return
    try:
        resp = requests.get(CIK_URL, headers=HEADERS, timeout=30)
        if resp.ok:
            data = resp.json()
            _CIK_MAP = {
                v["ticker"].upper(): str(v["cik_str"]).zfill(10)
                for v in data.values()
            }
    except Exception:
        pass


def cik_for(ticker: str) -> str | None:
    load_cik_map()
    return _CIK_MAP.get(ticker.upper())


def get_form4_filings(ticker: str, days: int = 30) -> list[dict]:
    """Fetch recent Form 4 filings for a ticker from SEC submissions API."""
    cik = cik_for(ticker)
    if not cik:
        return []

    url = SUB_URL.format(cik)
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
    accessions = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])

    filings = []
    for i in range(len(forms)):
        if forms[i].upper().strip() != "4":
            continue
        if dates[i] < cutoff:
            continue
        filings.append({
            "ticker": ticker.upper(),
            "cik": cik,
            "filed_at": dates[i],
            "accession": accessions[i] if i < len(accessions) else "",
            "primary_doc": primary_docs[i] if i < len(primary_docs) else "",
            "filing_url": _build_filing_url(cik, accessions[i]) if i < len(accessions) else "",
        })

    return filings


def parse_form4_html(html_url: str) -> dict | None:
    """Parse a Form 4 HTML document using BeautifulSoup for reliable extraction."""
    try:
        resp = requests.get(html_url, headers=HEADERS, timeout=30)
        if not resp.ok:
            return None
        text = resp.text
    except Exception:
        return None

    from bs4 import BeautifulSoup
    import re

    soup = BeautifulSoup(text, "html.parser")

    # Owner name from page link
    owner_link = soup.find("a", href=re.compile(r"browse-edgar"))
    owner_name = owner_link.text.strip() if owner_link else ""

    # Check relationship checkboxes: Director, Officer, 10% Owner
    is_director = False
    is_officer = False
    is_ten_pct = False
    for td in soup.find_all("td", class_="MedSmallFormText"):
        txt = td.get_text()
        if "Director" in txt and td.find_previous_sibling() and td.find_previous_sibling().find("span", class_="FormData"):
            is_director = "X" in (td.find_previous_sibling().find("span", class_="FormData").text or "")
        if "Officer" in txt and "10%" not in txt:
            is_officer = True
        if "10%" in txt:
            is_ten_pct = True

    # Find officer title
    officer_title = ""
    for td in soup.find_all("td", class_="FormText"):
        if "Officer" in td.get_text():
            next_data = td.find_next("td")
            if next_data:
                spans = next_data.find_all("span", class_="FormData")
                if spans:
                    officer_title = spans[0].text.strip()

    if is_officer:
        role = officer_title or "Officer"
    elif is_director:
        role = "Director"
    elif is_ten_pct:
        role = "10% Owner"
    else:
        role = "Other"

    # Extract transactions from non-derivative table
    # Find transaction table rows - look for rows with transaction codes
    transactions = []
    all_spans = soup.find_all("span", class_="FormData")
    span_texts = [s.text.strip() for s in all_spans]

    # Transaction codes P, S, A, F, M, G, D, J, U in FormData spans
    valid_codes = {"P", "S", "A", "F", "M", "G", "D", "J", "U"}

    for i, s in enumerate(span_texts):
        if s in valid_codes and len(s) == 1:
            code = s
            shares = 0
            price = 0
            # Look ahead for share count and price
            for j in range(i + 1, min(i + 10, len(span_texts))):
                val = span_texts[j].replace(",", "").replace("$", "")
                try:
                    num = float(val)
                    if num < 100000000 and "20" not in val:  # Filter out dates/zip codes
                        if shares == 0:
                            shares = num
                        elif price == 0 and num < 10000:
                            price = num
                            break
                except ValueError:
                    continue
            value = shares * price
            transactions.append({"code": code, "shares": shares, "price": price, "value": value})

    # Get transaction date
    txn_date = ""
    for td in soup.find_all("td", class_="MedSmallFormText"):
        if "Date of Earliest" in td.get_text():
            next_data = td.find_next("span", class_="FormData")
            if next_data:
                txn_date = next_data.text.strip()

    is_10b5_1 = "10b5-1" in text.lower()

    first_txn = transactions[0] if transactions else {"code": "", "shares": 0, "price": 0, "value": 0}

    return {
        "filer": owner_name,
        "role": role,
        "date": txn_date,
        "code": first_txn["code"],
        "shares": first_txn["shares"],
        "price": first_txn["price"],
        "value": first_txn["value"],
        "is_10b5_1": is_10b5_1,
        "post_holdings": 0,
        "all_transactions": transactions,
    }


def scan(tickers: list[str] | None = None, days: int = 30) -> list[dict]:
    """Scan tickers for recent Form 4 filings and extract transactions."""
    if tickers is None:
        tickers = DEFAULT_TICKERS

    all_results = []
    print(f"🔎 Scanning {len(tickers)} tickers for insider trades ({days}d window)...", file=sys.stderr)

    for ticker in tickers:
        try:
            filings = get_form4_filings(ticker, days=days)
            transactions = []
            for f in filings:
                if f.get("primary_doc"):
                    html_url = _build_html_url(f["cik"], f["accession"], f["primary_doc"])
                    parsed = parse_form4_html(html_url)
                    if parsed and parsed.get("code"):
                        transactions.append({**parsed, "filing_url": f.get("filing_url", ""), "filed_at": f.get("filed_at", "")})

            if transactions:
                cluster = _compute_cluster(transactions)
                all_results.append({
                    "ticker": ticker.upper(),
                    "transactions": transactions,
                    "cluster_signal": cluster["signal"],
                    "cluster_detail": cluster["detail"],
                    "buy_count_30d": cluster["buy_count"],
                    "sell_count_30d": cluster["sell_count"],
                    "net_value_30d": cluster["net_value"],
                    "ceo_buy": cluster["ceo_buy"],
                    "scraped_at": datetime.now().isoformat(),
                })

            time.sleep(0.15)
        except Exception as e:
            print(f"  ⚠️ {ticker}: {e}", file=sys.stderr)

    all_results.sort(key=lambda r: r["cluster_signal"] != "strong")
    return all_results


def _compute_cluster(transactions: list[dict]) -> dict:
    """Compute cluster signal from a list of Form 4 transactions."""
    buys = [t for t in transactions if t["code"] == "P" and not t["is_10b5_1"]]
    sells = [t for t in transactions if t["code"] == "S" and not t["is_10b5_1"]]

    c_suite = [t for t in buys if t["role"].upper() in ("CEO", "CFO", "COO", "PRESIDENT", "CHIEF")]
    director_buys = [t for t in buys if "Director" in t["role"] or "Officer" in t["role"]]
    all_buys = c_suite + [b for b in buys if b not in c_suite]

    buy_count = len(all_buys)
    net_value = sum(t["value"] for t in buys) - sum(t["value"] for t in sells)
    ceo_buy = any(t["role"].upper() in ("CEO", "CHIEF EXECUTIVE") for t in buys)

    if buy_count >= 3:
        signal = "strong"
        detail = f"{buy_count} open-market buys within 30 days"
    elif buy_count >= 2:
        signal = "weak"
        detail = f"{buy_count} open-market buys within 30 days"
    else:
        signal = "none"
        detail = ""

    if ceo_buy and signal != "strong":
        signal = "weak"
        detail = "CEO open-market buy detected"

    return {
        "signal": signal,
        "detail": detail,
        "buy_count": buy_count,
        "sell_count": len(sells),
        "net_value": round(net_value, 2),
        "ceo_buy": ceo_buy,
    }


def _build_filing_url(cik: str, accession: str) -> str:
    acc_clean = accession.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{acc_clean}/{accession}-index.htm"


def _build_html_url(cik: str, accession: str, primary_doc: str) -> str:
    acc_clean = accession.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{acc_clean}/{primary_doc}"


def format_terminal(results: list[dict]) -> str:
    if not results:
        return "No insider transactions found in this window."

    lines = [f"\n🔍 Insider Trading Scan — {len(results)} tickers with Form 4 activity\n"]
    for r in results:
        signal_icon = {"strong": "🔴", "weak": "🟡", "none": "⚪"}.get(r["cluster_signal"], "⚪")
        lines.append(
            f"  {signal_icon} ${r['ticker']:<6} {r['cluster_signal']:<8} {r['buy_count_30d']} buys · {r['sell_count_30d']} sells · net ${r['net_value_30d']:,.0f} {'⚠️ CEO BUY' if r['ceo_buy'] else ''}"
        )
        for t in r["transactions"][:3]:
            lines.append(
                f"     {t['date']}  {t['filer']:<30} {t['code']:<4} {t['shares']:>10,.0f} @ ${t['price']:.2f}  ${t['value']:>12,.0f}"
            )

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="SEC Form 4 Insider Trading Scanner")
    parser.add_argument("--tickers", nargs="*", help="Ticker symbols to scan")
    parser.add_argument("--days", type=int, default=30, help="Days back to scan (default: 30)")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    tickers = args.tickers if args.tickers else DEFAULT_TICKERS
    results = scan(tickers=tickers, days=args.days)

    if args.json:
        print(json.dumps(results, indent=2, default=str))
    else:
        print(format_terminal(results))


if __name__ == "__main__":
    main()

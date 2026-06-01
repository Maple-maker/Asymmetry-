#!/usr/bin/env python3
"""
HTML report generator for Asymmetry Opportunity Radar.
Produces a self-contained HTML file styled like a Bloomberg terminal / hedge fund brief.
"""

import json
import os
from datetime import datetime
from typing import Any

REPORT_DIR = os.path.join(os.path.dirname(__file__), "..", "reports")


def _bar(score: float, max_score: float = 10, width: int = 10) -> str:
    filled = round(score / max_score * width)
    empty = width - filled
    return "█" * filled + "░" * empty


def _pct(val: float | None, decimals: int = 1) -> str:
    if val is None:
        return "N/A"
    return f"{val * 100:.{decimals}f}%"


def _fmt(val: Any, prefix: str = "", suffix: str = "") -> str:
    if val is None:
        return "N/A"
    if isinstance(val, float):
        return f"{prefix}{val:,.2f}{suffix}"
    return f"{prefix}{val}{suffix}"


def generate_html_report(data: dict) -> str:
    """
    data keys:
      ticker, company_name, tier, thesis, price, target_price, floor_price,
      upside_pct, downside_pct, horizon,
      scores: {asymmetry, conviction, catalyst, management},
      overall_score,
      business_model, moat, competitors,
      catalysts: [{event, timing}],
      bear_floor, bull_ceiling,
      asymmetry_verdict,
      peers: [{name, ps_ttm, ps_fwd, p_fcf, ev_ebitda, gross_margin, rev_growth}],
      red_flags: [{severity, title, description, source}],
      invalidation_trigger,
      bear_verdict,
      snapshot: dict from fmp_client.get_radar_snapshot()
    """
    t = data.get("ticker", "UNKN")
    tier = data.get("tier", 2)
    tier_color = {"1": "#ff4444", "2": "#ff8800", "3": "#ffcc00"}.get(str(tier), "#ff8800")
    scores = data.get("scores", {})
    snap = data.get("snapshot", {})
    peers = data.get("peers", [])
    red_flags = data.get("red_flags", [])
    catalysts = data.get("catalysts", [])
    generated = datetime.now().strftime("%B %d, %Y — %H:%M UTC")

    severity_color = {"High": "#ff4444", "Medium": "#ff8800", "Low": "#44aa44", "Low-Med": "#88cc00"}

    # Build peer comparison rows
    peer_rows = ""
    metrics = [
        ("P/S (TTM)", "ps_ttm", "x"),
        ("P/S (Fwd)", "ps_fwd", "x"),
        ("P/FCF", "p_fcf", "x"),
        ("EV/EBITDA", "ev_ebitda", "x"),
        ("Gross Margin", "gross_margin", "%", True),
        ("YoY Rev Growth", "rev_growth", "%", True),
    ]
    for label, key, unit, *is_pct in metrics:
        row = f'<tr><td class="metric-label">{label}</td>'
        for p in [{"name": t, **data.get("own_metrics", {})}] + peers:
            val = p.get(key)
            if val is None:
                cell = "—"
            elif is_pct:
                cell = f"{val * 100:.1f}{unit}"
            else:
                cell = f"{val:.1f}{unit}"
            row += f"<td>{cell}</td>"
        peer_rows += f"{row}</tr>\n"

    # Peer header
    peer_headers = f'<th>{t}</th>' + "".join(f'<th>{p.get("name","—")}</th>' for p in peers)

    # Red flags
    flag_html = ""
    for flag in red_flags:
        sev = flag.get("severity", "Medium")
        color = severity_color.get(sev, "#ff8800")
        flag_html += f"""
        <div class="red-flag">
          <div class="flag-header">
            <span class="flag-title">{flag.get('title','')}</span>
            <span class="severity-badge" style="background:{color}">{sev}</span>
          </div>
          <p>{flag.get('description','')}</p>
          <span class="source">Source: {flag.get('source','')}</span>
        </div>"""

    # Catalysts
    cat_html = "".join(
        f'<li><span class="cat-num">{i+1}</span> {c.get("event","")} <span class="cat-timing">— {c.get("timing","")}</span></li>'
        for i, c in enumerate(catalysts)
    )

    # Score bars
    def score_row(label: str, key: str) -> str:
        val = scores.get(key, 0)
        return f"""<div class="score-row">
          <span class="score-label">{label}</span>
          <span class="score-bar">{_bar(val)}</span>
          <span class="score-val">{val}/10</span>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{t} — Asymmetry Radar</title>
  <style>
    :root {{
      --bg: #0d0d0d; --surface: #161616; --border: #2a2a2a;
      --text: #e8e8e8; --muted: #888; --accent: #00d4aa;
      --red: #ff4444; --orange: #ff8800; --green: #44cc88;
      --tier: {tier_color};
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            background: var(--bg); color: var(--text); padding: 32px;
            max-width: 1100px; margin: 0 auto; line-height: 1.6; }}
    h1 {{ font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }}
    h2 {{ font-size: 13px; text-transform: uppercase; letter-spacing: 2px;
          color: var(--accent); margin: 40px 0 16px; border-bottom: 1px solid var(--border);
          padding-bottom: 8px; }}
    h3 {{ font-size: 14px; font-weight: 600; margin-bottom: 8px; }}
    p {{ color: #ccc; font-size: 14px; line-height: 1.7; }}

    /* Header */
    .header {{ display: flex; align-items: flex-start; gap: 24px; margin-bottom: 40px; }}
    .tier-badge {{ background: var(--tier); color: #000; font-weight: 700;
                   font-size: 11px; padding: 4px 10px; border-radius: 4px;
                   letter-spacing: 1px; white-space: nowrap; margin-top: 6px; }}
    .generated {{ color: var(--muted); font-size: 11px; margin-top: 4px; }}
    .thesis {{ font-size: 15px; color: #ddd; margin-top: 8px; font-style: italic; }}

    /* Metric cards */
    .cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
              gap: 12px; margin: 16px 0; }}
    .card {{ background: var(--surface); border: 1px solid var(--border);
             border-radius: 8px; padding: 16px; }}
    .card-label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px;
                   color: var(--muted); margin-bottom: 6px; }}
    .card-value {{ font-size: 22px; font-weight: 700; }}
    .card-value.green {{ color: var(--green); }}
    .card-value.red {{ color: var(--red); }}
    .card-value.orange {{ color: var(--orange); }}
    .card-sub {{ font-size: 11px; color: var(--muted); margin-top: 4px; }}

    /* Scores */
    .scores {{ background: var(--surface); border: 1px solid var(--border);
               border-radius: 8px; padding: 20px; }}
    .score-row {{ display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }}
    .score-label {{ width: 130px; font-size: 12px; color: var(--muted); }}
    .score-bar {{ font-size: 14px; color: var(--accent); letter-spacing: 1px; }}
    .score-val {{ font-size: 13px; font-weight: 600; }}
    .overall-score {{ font-size: 48px; font-weight: 700; color: var(--accent);
                      text-align: right; }}
    .score-grid {{ display: grid; grid-template-columns: 1fr auto; gap: 16px;
                   align-items: center; }}

    /* Asymmetry model */
    .asym-grid {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }}
    .asym-card {{ background: var(--surface); border: 1px solid var(--border);
                  border-radius: 8px; padding: 16px; text-align: center; }}
    .asym-card.bull {{ border-color: var(--green); }}
    .asym-card.base {{ border-color: var(--accent); }}
    .asym-card.bear {{ border-color: var(--red); }}
    .asym-label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 2px;
                   color: var(--muted); margin-bottom: 8px; }}
    .asym-price {{ font-size: 24px; font-weight: 700; }}
    .asym-pct {{ font-size: 13px; margin-top: 4px; }}
    .bull .asym-price, .bull .asym-pct {{ color: var(--green); }}
    .base .asym-price, .base .asym-pct {{ color: var(--accent); }}
    .bear .asym-price, .bear .asym-pct {{ color: var(--red); }}

    /* Catalysts */
    .catalyst-list {{ list-style: none; }}
    .catalyst-list li {{ display: flex; gap: 12px; align-items: baseline;
                         padding: 10px 0; border-bottom: 1px solid var(--border); }}
    .cat-num {{ background: var(--accent); color: #000; font-size: 10px; font-weight: 700;
                padding: 2px 7px; border-radius: 10px; white-space: nowrap; }}
    .cat-timing {{ color: var(--muted); font-size: 12px; }}

    /* Peer table */
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th {{ background: var(--surface); color: var(--muted); font-size: 10px;
          text-transform: uppercase; letter-spacing: 1px; padding: 10px 12px;
          text-align: right; border-bottom: 1px solid var(--border); }}
    th:first-child {{ text-align: left; }}
    td {{ padding: 10px 12px; border-bottom: 1px solid var(--border);
          text-align: right; }}
    td:first-child {{ text-align: left; }}
    .metric-label {{ color: var(--muted); font-size: 12px; }}
    tr:hover td {{ background: var(--surface); }}

    /* Red flags */
    .red-flag {{ border-left: 3px solid var(--red); background: var(--surface);
                 padding: 16px 20px; margin-bottom: 12px; border-radius: 0 8px 8px 0; }}
    .flag-header {{ display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 8px; }}
    .flag-title {{ font-weight: 600; font-size: 14px; }}
    .severity-badge {{ font-size: 10px; font-weight: 700; padding: 3px 8px;
                       border-radius: 4px; color: #000; }}
    .source {{ font-size: 11px; color: var(--muted); font-style: italic; }}

    /* Invalidation trigger */
    .invalidation {{ background: #1a0a0a; border: 1px solid var(--red);
                     border-radius: 8px; padding: 20px; margin-top: 16px; }}
    .invalidation-label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 2px;
                           color: var(--red); font-weight: 700; margin-bottom: 8px; }}

    /* Moat */
    .moat-box {{ background: var(--surface); border: 1px solid var(--border);
                 border-radius: 8px; padding: 20px; }}
    .competitors {{ display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }}
    .competitor-tag {{ background: var(--border); font-size: 12px; padding: 4px 10px;
                       border-radius: 4px; }}

    /* Verdict */
    .verdict {{ background: #0a1a12; border: 1px solid var(--green);
                border-radius: 8px; padding: 20px; margin-top: 16px; }}
    .verdict-label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 2px;
                      color: var(--green); font-weight: 700; margin-bottom: 8px; }}

    /* Insider signal */
    .insider-row {{ display: flex; gap: 24px; margin: 8px 0; }}
    .insider-buy {{ color: var(--green); font-weight: 600; }}
    .insider-sell {{ color: var(--red); font-weight: 600; }}
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div>
      <div style="display:flex; gap:12px; align-items:center;">
        <h1>${t}</h1>
        <span class="tier-badge">TIER {tier}</span>
      </div>
      <div style="color:var(--muted); font-size:14px; margin-top:4px;">{data.get('company_name','')}</div>
      <div class="generated">Generated: {generated}</div>
      <div class="thesis">"{data.get('thesis','')}"</div>
    </div>
  </div>

  <!-- KEY METRICS -->
  <h2>Key Metrics</h2>
  <div class="cards">
    <div class="card">
      <div class="card-label">Current Price</div>
      <div class="card-value">${snap.get('price', data.get('price', '—'))}</div>
      <div class="card-sub">{snap.get('pct_from_52w_high', '—')}% from 52W high</div>
    </div>
    <div class="card">
      <div class="card-label">Market Cap</div>
      <div class="card-value">{_fmt(snap.get('market_cap'), prefix='$')}</div>
      <div class="card-sub">Analyst coverage: {snap.get('analyst_count', '—')}</div>
    </div>
    <div class="card">
      <div class="card-label">YoY Rev Growth</div>
      <div class="card-value green">{_pct(snap.get('revenue_growth_yoy'))}</div>
      <div class="card-sub">TTM P/S: {_fmt(snap.get('ps_ttm'))}x</div>
    </div>
    <div class="card">
      <div class="card-label">Gross Margin</div>
      <div class="card-value">{_pct(snap.get('gross_margin'))}</div>
      <div class="card-sub">Op. Margin: {_pct(snap.get('operating_margin'))}</div>
    </div>
    <div class="card">
      <div class="card-label">Insider Signal</div>
      <div class="card-value {'green' if snap.get('insider_signal')=='BUY' else 'red' if snap.get('insider_signal')=='SELL' else ''}">{snap.get('insider_signal', '—')}</div>
      <div class="card-sub">Buys {snap.get('insider_buys_recent','—')} / Sells {snap.get('insider_sells_recent','—')}</div>
    </div>
    <div class="card">
      <div class="card-label">EV / EBITDA</div>
      <div class="card-value">{_fmt(snap.get('ev_ebitda'))}x</div>
      <div class="card-sub">P/FCF: {_fmt(snap.get('p_fcf'))}x</div>
    </div>
  </div>

  <!-- CONVICTION SCORES -->
  <h2>Conviction Scores</h2>
  <div class="scores">
    <div class="score-grid">
      <div>
        {score_row("Asymmetry", "asymmetry")}
        {score_row("Conviction", "conviction")}
        {score_row("Catalyst Strength", "catalyst")}
        {score_row("Management Quality", "management")}
      </div>
      <div>
        <div class="overall-score">{data.get('overall_score', '—')}</div>
        <div style="text-align:right; color:var(--muted); font-size:11px;">/ 100</div>
      </div>
    </div>
  </div>

  <!-- ASYMMETRY MODEL -->
  <h2>Asymmetry Model</h2>
  <div class="asym-grid">
    <div class="asym-card bear">
      <div class="asym-label">Bear / Floor</div>
      <div class="asym-price">${data.get('floor_price','—')}</div>
      <div class="asym-pct">-{data.get('downside_pct','—')}%</div>
    </div>
    <div class="asym-card base">
      <div class="asym-label">Base / Target</div>
      <div class="asym-price">${data.get('target_price','—')}</div>
      <div class="asym-pct">+{data.get('upside_pct','—')}%</div>
    </div>
    <div class="asym-card bull">
      <div class="asym-label">Bull / Ceiling</div>
      <div class="asym-price">${data.get('bull_ceiling','—')}</div>
      <div class="asym-pct">{data.get('bull_multiple','—')}x potential</div>
    </div>
  </div>
  <div class="verdict" style="margin-top:12px;">
    <div class="verdict-label">Asymmetry Verdict</div>
    <p>{data.get('asymmetry_verdict','')}</p>
  </div>

  <!-- BUSINESS MODEL & MOAT -->
  <h2>Business Model & Moat</h2>
  <div class="moat-box">
    <h3>How They Make Money</h3>
    <p style="margin-bottom:16px;">{data.get('business_model','')}</p>
    <h3>Top Competitors</h3>
    <div class="competitors">
      {''.join(f'<span class="competitor-tag">{c}</span>' for c in data.get('competitors',[]))}
    </div>
    <h3 style="margin-top:16px;">Competitive Moat</h3>
    <p>{data.get('moat','')}</p>
  </div>

  <!-- CATALYSTS -->
  <h2>Catalysts — Next 12 Months</h2>
  <ul class="catalyst-list">{cat_html}</ul>

  <!-- PEER COMPARISON -->
  <h2>Peer Comparison</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        {peer_headers}
      </tr>
    </thead>
    <tbody>{peer_rows}</tbody>
  </table>

  <!-- BEAR CASE -->
  <h2>Bear Case</h2>
  {flag_html}
  <div class="invalidation">
    <div class="invalidation-label">⚠ Invalidation Trigger</div>
    <p>{data.get('invalidation_trigger','')}</p>
  </div>

</body>
</html>"""

    return html


def save_report(html: str, ticker: str) -> str:
    """Save HTML report to reports/ directory. Returns the file path."""
    os.makedirs(REPORT_DIR, exist_ok=True)
    date_str = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"{ticker.upper()}_{date_str}.html"
    path = os.path.join(REPORT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


if __name__ == "__main__":
    # Demo with placeholder data
    demo = {
        "ticker": "DEMO", "company_name": "Demo Corp", "tier": 1,
        "thesis": "This is a placeholder thesis for the demo report.",
        "price": 42.00, "target_price": 120, "floor_price": 30,
        "upside_pct": 185, "downside_pct": 28, "bull_ceiling": 200, "bull_multiple": "4.7",
        "scores": {"asymmetry": 9, "conviction": 8, "catalyst": 8, "management": 7},
        "overall_score": 85,
        "business_model": "Demo company makes money by selling widgets.",
        "moat": "Proprietary widget technology with 12 active patents.",
        "competitors": ["CompA", "CompB", "CompC"],
        "catalysts": [
            {"event": "DoD contract award", "timing": "Q3 2026"},
            {"event": "First profitable quarter", "timing": "Q4 2026"},
        ],
        "peers": [
            {"name": "CompA", "ps_ttm": 3.2, "gross_margin": 0.45, "rev_growth": 0.22},
            {"name": "CompB", "ps_ttm": 8.1, "gross_margin": 0.61, "rev_growth": 0.18},
        ],
        "red_flags": [
            {"severity": "High", "title": "Customer Concentration",
             "description": "Top customer = 38% of revenue.", "source": "10-K FY25"},
            {"severity": "Medium", "title": "Margin Compression",
             "description": "Gross margin down 3pp over 4 quarters.", "source": "Q4 FY25 earnings"},
        ],
        "invalidation_trigger": "Revenue guidance cut below $100M OR gross margin below 40% for 2 consecutive quarters.",
        "asymmetry_verdict": "Risk/reward is skewed 6:1 in favor of the bull case.",
        "snapshot": {},
    }
    html = generate_html_report(demo)
    path = save_report(html, "DEMO")
    print(f"Report saved: {path}")

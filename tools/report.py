#!/usr/bin/env python3
"""
HTML report generator for Asymmetry Opportunity Radar.
Produces a self-contained, print-to-PDF-ready equity brief.
Styled as a boutique hedge fund research note.
"""

import json
import os
import re
from datetime import datetime
from typing import Any

REPORT_DIR = os.path.join(os.path.dirname(__file__), "..", "reports")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _pct(val, decimals=1):
    if val is None: return "N/A"
    return f"{val * 100:.{decimals}f}%"

def _money(val, decimals=0):
    if val is None: return "N/A"
    if abs(val) >= 1e12: return f"${val/1e12:.2f}T"
    if abs(val) >= 1e9:  return f"${val/1e9:.1f}B"
    if abs(val) >= 1e6:  return f"${val/1e6:.{decimals}f}M"
    return f"${val:,.0f}"

def _x(val):
    if val is None: return "N/A"
    return f"{val:.1f}x"

def _num(val, suffix="", decimals=1):
    if val is None: return "N/A"
    return f"{val:.{decimals}f}{suffix}"

def _score_bar(val, max_val=10, width=10):
    filled = round((val or 0) / max_val * width)
    return "█" * filled + "░" * (width - filled)

def _color(val, high_is_good=True):
    """Return CSS class based on value sentiment."""
    if val is None: return ""
    if high_is_good: return "pos" if val > 0 else "neg"
    return "neg" if val > 0 else "pos"


# ── Main report ────────────────────────────────────────────────────────────────

def generate_html_report(data: dict) -> str:
    """
    Generate a self-contained HTML equity brief.

    Required keys in data:
      ticker, company_name, tier, thesis
      price, target_price, floor_price, bull_ceiling
      upside_pct, downside_pct, bull_multiple
      scores: {asymmetry, conviction, catalyst, management}
      overall_score
      business_model       ← How the company makes money
      revenue_streams      ← List of strings describing revenue streams
      moat
      competitors: [str]
      catalysts: [{event, timing}]
      peers: [{name, ps_ttm, ps_fwd, p_fcf, ev_ebitda, gross_margin, rev_growth}]
      own_metrics: {ps_ttm, ps_fwd, p_fcf, ev_ebitda, gross_margin, rev_growth}
      red_flags: [{severity, title, description, source}]
      invalidation_trigger
      asymmetry_verdict
      bear_verdict
      analysis_text        ← Raw Gemini 7-question analysis (optional)
      snapshot: dict       ← From yf_client / fmp_client
    """
    t            = data.get("ticker", "UNKN").upper()
    co           = data.get("company_name", "")
    tier         = int(data.get("tier", 2))
    scores       = data.get("scores", {})
    snap         = data.get("snapshot", {})
    peers        = data.get("peers", [])
    own          = data.get("own_metrics", {})
    red_flags    = data.get("red_flags", [])
    catalysts    = data.get("catalysts", [])
    streams      = data.get("revenue_streams", [])
    generated    = datetime.utcnow().strftime("%B %d, %Y  %H:%M UTC")

    tier_label  = {1: "TIER 1 — EXCEPTIONAL", 2: "TIER 2 — HIGH CONVICTION", 3: "TIER 3 — WATCHLIST"}.get(tier, f"TIER {tier}")
    tier_color  = {1: "#ef4444", 2: "#f97316", 3: "#eab308"}.get(tier, "#f97316")

    sev_color   = {"High": "#ef4444", "Medium": "#f97316", "Low": "#22c55e"}

    price     = snap.get("price") or data.get("price")
    mktcap    = snap.get("market_cap")
    yh        = snap.get("52w_high") or snap.get("year_high")
    yl        = snap.get("52w_low")  or snap.get("year_low")
    from_high = snap.get("pct_from_52w_high") or snap.get("pct_from_high")
    rev_g     = snap.get("revenue_growth_yoy") or snap.get("revenue_growth")
    gm        = snap.get("gross_margin")
    om        = snap.get("operating_margin")
    ps        = snap.get("ps_ttm") or own.get("ps_ttm")
    evebitda  = snap.get("ev_ebitda") or own.get("ev_ebitda")
    ins_sig   = snap.get("insider_signal", "—")
    ins_b     = snap.get("insider_buys_recent") or snap.get("insider_buys", 0)
    ins_s     = snap.get("insider_sells_recent") or snap.get("insider_sells", 0)
    analysts  = snap.get("analyst_count", "—")

    # ── Build subsections ─────────────────────────────────────────────────────

    # Revenue streams
    streams_html = ""
    if streams:
        items = "".join(f"<li>{s}</li>" for s in streams)
        streams_html = f'<ul class="streams">{items}</ul>'

    # Score rows
    def score_row(label, key):
        v = scores.get(key, 0) or 0
        return f"""<div class="srow">
          <span class="slabel">{label}</span>
          <span class="sbar">{_score_bar(v)}</span>
          <span class="sval">{v}/10</span>
        </div>"""

    # Asymmetry grid
    fp  = data.get("floor_price", "—")
    tp  = data.get("target_price", "—")
    bc  = data.get("bull_ceiling", "—")
    up  = data.get("upside_pct", "—")
    dn  = data.get("downside_pct", "—")
    bm  = data.get("bull_multiple", "—")

    # Peer table
    peer_names = [t] + [p.get("name", "—") for p in peers]
    peer_head  = "".join(f"<th>{n}</th>" for n in peer_names)

    def peer_row(label, key, fmt_fn):
        own_val = own.get(key)
        cells = f"<td>{fmt_fn(own_val) if own_val is not None else '—'}</td>"
        for p in peers:
            v = p.get(key)
            cells += f"<td>{fmt_fn(v) if v is not None else '—'}</td>"
        return f"<tr><td class='mlabel'>{label}</td>{cells}</tr>"

    # Value/Growth score
    def vg_score(obj):
        ps_v = obj.get("ps_ttm")
        rg_v = obj.get("rev_growth")
        if ps_v and rg_v and rg_v > 0:
            return f"{ps_v / (rg_v * 100):.2f}"
        return "—"

    vg_row = f"<tr><td class='mlabel'>Value/Growth*</td><td>{vg_score(own)}</td>"
    for p in peers:
        vg_row += f"<td>{vg_score(p)}</td>"
    vg_row += "</tr>"

    peer_table = f"""<table>
      <thead><tr><th>Metric</th>{peer_head}</tr></thead>
      <tbody>
        {peer_row("P/S (TTM)",    "ps_ttm",      _x)}
        {peer_row("P/S (Fwd)",    "ps_fwd",       _x)}
        {peer_row("P/FCF",        "p_fcf",        _x)}
        {peer_row("EV/EBITDA",    "ev_ebitda",    _x)}
        {peer_row("Gross Margin", "gross_margin", _pct)}
        {peer_row("YoY Rev Grwth","rev_growth",   _pct)}
        {vg_row}
      </tbody>
    </table>
    <p class="tfoot">* Value/Growth = P/S TTM ÷ YoY Rev Growth %. Lower = more attractive relative to growth rate.</p>"""

    # Catalysts
    cat_rows = "".join(
        f"""<div class="cat-row">
          <span class="cat-n">{i+1}</span>
          <div><div class="cat-event">{c.get('event','')}</div>
          <div class="cat-timing">{c.get('timing','')}</div></div>
        </div>"""
        for i, c in enumerate(catalysts)
    )

    # Red flags
    def flag_card(flag):
        sev   = flag.get("severity", "Medium")
        color = sev_color.get(sev, "#f97316")
        return f"""<div class="flag" style="border-color:{color}">
          <div class="flag-hdr">
            <span class="flag-title">{flag.get('title','')}</span>
            <span class="sev-badge" style="background:{color}">{sev.upper()}</span>
          </div>
          <p class="flag-desc">{flag.get('description','')}</p>
          <div class="flag-src">Source: {flag.get('source','')}</div>
        </div>"""

    flags_html = "".join(flag_card(f) for f in red_flags)

    # 7-question analysis (raw text → formatted)
    analysis_html = ""
    raw = data.get("analysis_text", "")
    if raw:
        # Bold the numbered questions
        cleaned = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', raw)
        cleaned = re.sub(r'\n', '<br>', cleaned)
        analysis_html = f'<div class="analysis-body">{cleaned}</div>'

    # Insider signal CSS class
    ins_class = "pos" if ins_sig == "BUY" else "neg" if ins_sig == "SELL" else ""

    # ── HTML ──────────────────────────────────────────────────────────────────
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{t} — Asymmetry Radar</title>
  <style>
    /* ── Tokens ── */
    :root {{
      --bg:#0c0c0e; --surface:#141417; --surface2:#1c1c20;
      --border:#2a2a30; --text:#e2e2e8; --muted:#6b6b7a;
      --accent:#00d4aa; --pos:#22c55e; --neg:#ef4444; --warn:#f97316;
      --tier:{tier_color};
      --font:'SF Mono','Fira Code','Cascadia Code','Consolas',monospace;
    }}

    /* ── Reset ── */
    *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:var(--font);background:var(--bg);color:var(--text);
          padding:40px 48px;max-width:1120px;margin:0 auto;line-height:1.65;
          font-size:13px}}

    /* ── Typography ── */
    h1{{font-size:32px;font-weight:800;letter-spacing:-1px;line-height:1.1}}
    h2{{font-size:10px;text-transform:uppercase;letter-spacing:3px;color:var(--accent);
        margin:48px 0 18px;padding-bottom:8px;border-bottom:1px solid var(--border)}}
    h3{{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;
        color:var(--muted);margin-bottom:10px}}
    p{{color:#b0b0bc;font-size:13px;line-height:1.8}}
    a{{color:var(--accent);text-decoration:none}}

    /* ── Utilities ── */
    .pos{{color:var(--pos)}} .neg{{color:var(--neg)}} .warn{{color:var(--warn)}}
    .muted{{color:var(--muted)}}
    .mono{{font-family:var(--font)}}

    /* ── Cover ── */
    .cover{{margin-bottom:48px}}
    .cover-top{{display:flex;align-items:flex-start;gap:20px;margin-bottom:16px}}
    .ticker-block h1{{color:var(--text)}}
    .company-name{{color:var(--muted);font-size:14px;margin-top:4px}}
    .tier-badge{{background:var(--tier);color:#000;font-weight:800;font-size:10px;
                 padding:5px 12px;border-radius:4px;letter-spacing:2px;
                 white-space:nowrap;margin-top:8px}}
    .gen-date{{color:var(--muted);font-size:10px;margin-top:6px}}
    .thesis-block{{background:var(--surface);border-left:3px solid var(--tier);
                   padding:16px 20px;border-radius:0 8px 8px 0;margin-top:20px}}
    .thesis-label{{font-size:9px;text-transform:uppercase;letter-spacing:2px;
                   color:var(--tier);font-weight:700;margin-bottom:6px}}
    .thesis-text{{font-size:15px;color:var(--text);font-style:italic;line-height:1.5}}

    /* ── Metric cards ── */
    .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}}
    .card{{background:var(--surface);border:1px solid var(--border);
           border-radius:8px;padding:18px 16px}}
    .card-label{{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;
                 color:var(--muted);margin-bottom:8px}}
    .card-val{{font-size:22px;font-weight:700;line-height:1}}
    .card-sub{{font-size:10px;color:var(--muted);margin-top:6px}}

    /* ── Scores ── */
    .score-wrap{{background:var(--surface);border:1px solid var(--border);
                 border-radius:8px;padding:24px;display:grid;
                 grid-template-columns:1fr 120px;gap:24px;align-items:center}}
    .srow{{display:flex;align-items:center;gap:12px;margin-bottom:12px}}
    .srow:last-child{{margin-bottom:0}}
    .slabel{{width:140px;font-size:11px;color:var(--muted)}}
    .sbar{{color:var(--accent);letter-spacing:1px;font-size:14px}}
    .sval{{font-size:12px;font-weight:700;width:36px;text-align:right}}
    .overall{{text-align:right}}
    .overall-num{{font-size:56px;font-weight:800;color:var(--accent);line-height:1}}
    .overall-denom{{font-size:11px;color:var(--muted)}}

    /* ── Business model ── */
    .biz-grid{{display:grid;grid-template-columns:3fr 2fr;gap:24px}}
    .biz-box{{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px}}
    .streams{{margin-top:8px;padding-left:0;list-style:none}}
    .streams li{{padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;color:#b0b0bc}}
    .streams li:last-child{{border-bottom:none}}
    .streams li::before{{content:"▸ ";color:var(--accent)}}
    .competitors{{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}}
    .comp-tag{{background:var(--surface2);border:1px solid var(--border);
               font-size:11px;padding:4px 10px;border-radius:4px;color:var(--muted)}}

    /* ── Asymmetry model ── */
    .asym-grid{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}}
    .asym-card{{background:var(--surface);border:1px solid var(--border);
                border-radius:8px;padding:20px;text-align:center}}
    .asym-card.bear{{border-color:var(--neg);background:#160808}}
    .asym-card.base{{border-color:var(--accent);background:#081612}}
    .asym-card.bull{{border-color:var(--pos);background:#081208}}
    .asym-lbl{{font-size:9px;text-transform:uppercase;letter-spacing:2px;
               color:var(--muted);margin-bottom:10px}}
    .asym-price{{font-size:28px;font-weight:800}}
    .asym-chg{{font-size:12px;margin-top:6px;font-weight:600}}
    .bear .asym-price,.bear .asym-chg{{color:var(--neg)}}
    .base .asym-price,.base .asym-chg{{color:var(--accent)}}
    .bull .asym-price,.bull .asym-chg{{color:var(--pos)}}
    .verdict-box{{background:var(--surface2);border:1px solid var(--border);
                  border-radius:8px;padding:18px 20px;margin-top:14px}}
    .verdict-lbl{{font-size:9px;text-transform:uppercase;letter-spacing:2px;
                  color:var(--accent);font-weight:700;margin-bottom:8px}}

    /* ── Catalysts ── */
    .cat-row{{display:flex;gap:16px;align-items:flex-start;
              padding:14px 0;border-bottom:1px solid var(--border)}}
    .cat-row:last-child{{border-bottom:none}}
    .cat-n{{background:var(--accent);color:#000;font-size:9px;font-weight:800;
            padding:3px 8px;border-radius:10px;white-space:nowrap;margin-top:2px}}
    .cat-event{{font-size:13px;font-weight:600;margin-bottom:2px}}
    .cat-timing{{font-size:11px;color:var(--muted)}}

    /* ── Peer table ── */
    table{{width:100%;border-collapse:collapse;font-size:12px}}
    th{{background:var(--surface);color:var(--muted);font-size:9px;text-transform:uppercase;
        letter-spacing:1.5px;padding:10px 14px;text-align:right;
        border-bottom:1px solid var(--border)}}
    th:first-child{{text-align:left}}
    td{{padding:10px 14px;border-bottom:1px solid var(--border);
        text-align:right;color:#c8c8d4}}
    td:first-child{{text-align:left}}
    .mlabel{{color:var(--muted);font-size:11px}}
    tr:hover td{{background:var(--surface)}}
    .tfoot{{font-size:10px;color:var(--muted);margin-top:10px;font-style:italic}}

    /* ── Red flags ── */
    .flag{{border-left:3px solid var(--neg);background:var(--surface);
           padding:16px 20px;margin-bottom:12px;border-radius:0 8px 8px 0}}
    .flag-hdr{{display:flex;justify-content:space-between;align-items:center;
               margin-bottom:8px}}
    .flag-title{{font-weight:700;font-size:13px}}
    .sev-badge{{font-size:9px;font-weight:800;padding:3px 8px;
                border-radius:4px;color:#000;letter-spacing:1px}}
    .flag-desc{{font-size:12px;color:#b0b0bc;line-height:1.7}}
    .flag-src{{font-size:10px;color:var(--muted);font-style:italic;margin-top:8px}}

    /* ── Invalidation trigger ── */
    .inv-box{{background:#140808;border:1px solid var(--neg);
              border-radius:8px;padding:20px}}
    .inv-lbl{{font-size:9px;text-transform:uppercase;letter-spacing:2px;
              color:var(--neg);font-weight:800;margin-bottom:10px}}

    /* ── 7-question analysis ── */
    .analysis-body{{background:var(--surface);border:1px solid var(--border);
                    border-radius:8px;padding:24px;font-size:12px;
                    color:#b0b0bc;line-height:2}}

    /* ── Footer ── */
    .footer{{margin-top:60px;padding-top:20px;border-top:1px solid var(--border);
             font-size:10px;color:var(--muted);display:flex;
             justify-content:space-between}}

    /* ── Print ── */
    @media print {{
      body{{background:#fff;color:#111;padding:20px}}
      :root{{--bg:#fff;--surface:#f7f7f7;--surface2:#efefef;--border:#ddd;
             --text:#111;--muted:#555;--accent:#007a62;--pos:#166534;
             --neg:#991b1b;--warn:#9a3412;--tier:{tier_color}}}
      h2{{color:var(--accent)}}
      .cover{{page-break-after:always}}
      h2{{page-break-before:auto}}
      .flag,.asym-card,.card,.biz-box,.score-wrap{{break-inside:avoid}}
    }}
  </style>
</head>
<body>

<!-- ══ COVER ══════════════════════════════════════════════════════════ -->
<div class="cover">
  <div class="cover-top">
    <div class="ticker-block">
      <h1>${t}</h1>
      <div class="company-name">{co}</div>
    </div>
    <div>
      <div class="tier-badge">{tier_label}</div>
      <div class="gen-date">Asymmetry Radar &nbsp;·&nbsp; {generated}</div>
    </div>
  </div>
  <div class="thesis-block">
    <div class="thesis-label">Investment Thesis</div>
    <div class="thesis-text">{data.get('thesis','')}</div>
  </div>
</div>

<!-- ══ KEY METRICS ════════════════════════════════════════════════════ -->
<h2>Key Metrics</h2>
<div class="cards">
  <div class="card">
    <div class="card-label">Current Price</div>
    <div class="card-val">${price if price else "—"}</div>
    <div class="card-sub">52W: ${yl or "—"} – ${yh or "—"}</div>
  </div>
  <div class="card">
    <div class="card-label">From 52W High</div>
    <div class="card-val {_color(from_high, high_is_good=False)}">{_num(from_high,'%')}</div>
    <div class="card-sub">Market Cap: {_money(mktcap)}</div>
  </div>
  <div class="card">
    <div class="card-label">Revenue Growth</div>
    <div class="card-val {_color(rev_g)}">{_pct(rev_g)}</div>
    <div class="card-sub">P/S TTM: {_x(ps)}</div>
  </div>
  <div class="card">
    <div class="card-label">Gross Margin</div>
    <div class="card-val">{_pct(gm)}</div>
    <div class="card-sub">Op. Margin: {_pct(om)}</div>
  </div>
  <div class="card">
    <div class="card-label">EV / EBITDA</div>
    <div class="card-val">{_x(evebitda)}</div>
    <div class="card-sub">Analysts: {analysts}</div>
  </div>
  <div class="card">
    <div class="card-label">Insider Signal</div>
    <div class="card-val {ins_class}">{ins_sig}</div>
    <div class="card-sub">{ins_b} buys &nbsp;/&nbsp; {ins_s} sells</div>
  </div>
</div>

<!-- ══ BUSINESS MODEL ═════════════════════════════════════════════════ -->
<h2>Business Model</h2>
<div class="biz-grid">
  <div class="biz-box">
    <h3>How They Make Money</h3>
    <p>{data.get('business_model','')}</p>
    {streams_html}
  </div>
  <div>
    <div class="biz-box" style="margin-bottom:14px">
      <h3>Top Competitors</h3>
      <div class="competitors">
        {''.join(f'<span class="comp-tag">{c}</span>' for c in data.get('competitors',[]))}
      </div>
    </div>
    <div class="biz-box">
      <h3>Competitive Moat</h3>
      <p>{data.get('moat','')}</p>
    </div>
  </div>
</div>

<!-- ══ CONVICTION SCORES ══════════════════════════════════════════════ -->
<h2>Conviction Scorecard</h2>
<div class="score-wrap">
  <div>
    {score_row("Asymmetry",        "asymmetry")}
    {score_row("Conviction",       "conviction")}
    {score_row("Catalyst Strength","catalyst")}
    {score_row("Management Quality","management")}
  </div>
  <div class="overall">
    <div class="overall-num">{data.get('overall_score','—')}</div>
    <div class="overall-denom">/ 100</div>
  </div>
</div>

<!-- ══ ASYMMETRY MODEL ════════════════════════════════════════════════ -->
<h2>Asymmetry Model</h2>
<div class="asym-grid">
  <div class="asym-card bear">
    <div class="asym-lbl">Bear / Floor</div>
    <div class="asym-price">${fp}</div>
    <div class="asym-chg">−{dn}%</div>
  </div>
  <div class="asym-card base">
    <div class="asym-lbl">Base / Target</div>
    <div class="asym-price">${tp}</div>
    <div class="asym-chg">+{up}%</div>
  </div>
  <div class="asym-card bull">
    <div class="asym-lbl">Bull / Ceiling</div>
    <div class="asym-price">${bc}</div>
    <div class="asym-chg">{bm}x potential</div>
  </div>
</div>
<div class="verdict-box">
  <div class="verdict-lbl">Asymmetry Verdict</div>
  <p>{data.get('asymmetry_verdict','')}</p>
</div>

<!-- ══ CATALYSTS ══════════════════════════════════════════════════════ -->
<h2>Catalysts — Next 12 Months</h2>
<div class="cat-list">{cat_rows}</div>

<!-- ══ PEER COMPARISON ════════════════════════════════════════════════ -->
<h2>Peer Comparison — Relative Valuation</h2>
{peer_table}

<!-- ══ BEAR CASE ══════════════════════════════════════════════════════ -->
<h2>Bear Case</h2>
{flags_html}
<div class="inv-box">
  <div class="inv-lbl">⚠ Invalidation Trigger</div>
  <p>{data.get('invalidation_trigger','')}</p>
</div>

{'<!-- ══ 7-QUESTION ANALYSIS ══════════════════════════════════════════════ --><h2>Full Analysis</h2>' + analysis_html if analysis_html else ''}

<!-- ══ FOOTER ════════════════════════════════════════════════════════ -->
<div class="footer">
  <span>Asymmetry Opportunity Radar &nbsp;·&nbsp; {generated}</span>
  <span>This is not investment advice. Do your own research.</span>
</div>

</body>
</html>"""


def save_report(html: str, ticker: str) -> str:
    os.makedirs(REPORT_DIR, exist_ok=True)
    date_str = datetime.utcnow().strftime("%Y%m%d_%H%M")
    path = os.path.join(REPORT_DIR, f"{ticker.upper()}_{date_str}.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


if __name__ == "__main__":
    demo = {
        "ticker": "CODA", "company_name": "Coda Octopus Group Inc.", "tier": 2,
        "thesis": "The only public company selling real-time 3D sonar to navies, commercial divers, and offshore wind — a near-monopoly at $60M market cap with DoD adoption accelerating and zero sell-side coverage.",
        "price": 11.50, "target_price": 35, "floor_price": 8,
        "upside_pct": 204, "downside_pct": 30, "bull_ceiling": 60, "bull_multiple": "5.2",
        "scores": {"asymmetry": 9, "conviction": 7, "catalyst": 7, "management": 8},
        "overall_score": 78,
        "business_model": "Coda Octopus sells real-time 3D sonar systems (Echoscope) used by navies for mine countermeasures, commercial divers for subsea inspection, and offshore energy operators. Revenue splits roughly 60% products (one-time hardware) / 40% services (rentals, maintenance contracts). Gross margins run 55-65% on the services side.",
        "revenue_streams": [
            "Echoscope hardware sales to naval and commercial customers",
            "Marine technology rental fleet (high-margin, recurring)",
            "Maintenance, support, and training services",
            "Geosciences services (subsea surveys for offshore energy)",
        ],
        "moat": "Proprietary real-time 3D sonar is protected by 15+ patents. No direct competitor offers real-time volumetric imaging at equivalent quality. Switching costs are high — navies qualify specific systems through a multi-year process.",
        "competitors": ["Kongsberg (private)", "Teledyne FLIR", "Blueprint Subsea"],
        "catalysts": [
            {"event": "US Navy expanded contract award (mine countermeasures program)", "timing": "Q3 2026"},
            {"event": "First offshore wind installation contract", "timing": "Q4 2026"},
            {"event": "Analyst initiation — currently zero coverage", "timing": "2026"},
        ],
        "own_metrics": {"ps_ttm": 2.1, "p_fcf": 14.0, "ev_ebitda": 11.2, "gross_margin": 0.58, "rev_growth": 0.24},
        "peers": [
            {"name": "FLIR (FLIR)", "ps_ttm": 3.8, "p_fcf": 22.0, "ev_ebitda": 18.0, "gross_margin": 0.52, "rev_growth": 0.08},
            {"name": "Teledyne (TDY)", "ps_ttm": 2.9, "p_fcf": 18.0, "ev_ebitda": 15.5, "gross_margin": 0.47, "rev_growth": 0.05},
        ],
        "red_flags": [
            {"severity": "Medium", "title": "Customer Concentration",
             "description": "DoD-linked contracts represent ~40% of revenue. Budget cuts or program changes could materially impact near-term revenue.", "source": "10-K FY2025"},
            {"severity": "Low", "title": "Illiquidity",
             "description": "Average daily volume under 20K shares. Position sizing is constrained for any meaningful capital deployment.", "source": "Market data"},
        ],
        "invalidation_trigger": "Navy contract renewal fails OR revenue growth decelerates below 10% for 2 consecutive quarters. Either removes the near-term catalyst entirely.",
        "asymmetry_verdict": "At $60M market cap with 24% revenue growth, near-monopoly sonar technology, and zero analyst coverage, the risk/reward is skewed approximately 7:1 in favor of the bull case. The only credible bear case is a specific DoD program cancellation.",
        "bear_verdict": "Bull thesis holds unless DoD budget freeze materializes.",
        "analysis_text": "1. **Why interesting NOW?** Zero analyst coverage, navy adoption accelerating post-Ukraine mine warfare lessons...",
        "snapshot": {
            "price": 11.50, "market_cap": 61_000_000,
            "52w_high": 16.20, "52w_low": 8.10,
            "pct_from_52w_high": -29.0,
            "revenue_growth_yoy": 0.24, "gross_margin": 0.58,
            "operating_margin": 0.12, "ps_ttm": 2.1, "ev_ebitda": 11.2,
            "insider_signal": "BUY", "insider_buys_recent": 3, "insider_sells_recent": 0,
            "analyst_count": 0,
        },
    }
    html = generate_html_report(demo)
    path = save_report(html, "CODA")
    print(f"Report saved: {path}")

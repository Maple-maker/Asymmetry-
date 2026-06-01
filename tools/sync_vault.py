#!/usr/bin/env python3
"""
Obsidian vault sync for Asymmetry Opportunity Radar.

Pulls opportunities from Supabase and writes Obsidian-compatible markdown files
to vault/opportunities/TICKER_YYYYMMDD.md, plus a master _index.md and
_memory/agent_context.md.

Install: pip install supabase
Usage:   python3 tools/sync_vault.py
"""

import os
import sys
from datetime import datetime, date
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
VAULT_DIR = ROOT / "vault"
OPP_DIR = VAULT_DIR / "opportunities"
MEM_DIR = VAULT_DIR / "_memory"

# ── Supabase client ───────────────────────────────────────────────────────────

def _get_client():
    try:
        from supabase import create_client
    except ImportError:
        sys.exit("supabase-py not installed. Run: pip install supabase")

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        sys.exit(
            "Missing env vars. Export SUPABASE_URL and SUPABASE_SERVICE_KEY "
            "before running this script."
        )

    return create_client(url, key)


# ── Markdown builders ─────────────────────────────────────────────────────────

def _fmt_date(val) -> str:
    """Normalise a date/datetime value to YYYY-MM-DD string."""
    if val is None:
        return ""
    if isinstance(val, (date, datetime)):
        return val.strftime("%Y-%m-%d")
    # String — truncate to date portion
    return str(val)[:10]


def _frontmatter(row: dict) -> str:
    ticker = row.get("ticker", "UNKNOWN")
    tier = row.get("tier", "")
    overall_score = row.get("overall_score", "")
    floor_price = row.get("floor_price", "")
    target_price = row.get("target_price", "")
    bull_price = row.get("bull_price", row.get("bull_ceiling", ""))
    created_at = _fmt_date(row.get("created_at") or row.get("date", ""))
    status = row.get("status", "active")

    lines = ["---"]
    lines.append(f"ticker: {ticker}")
    if tier != "":
        lines.append(f"tier: {tier}")
    if overall_score != "":
        lines.append(f"overall_score: {overall_score}")
    if floor_price != "":
        lines.append(f"floor_price: {floor_price}")
    if target_price != "":
        lines.append(f"target_price: {target_price}")
    if bull_price != "":
        lines.append(f"bull_price: {bull_price}")
    lines.append(f"date: {created_at}")
    lines.append(f"status: {status}")
    lines.append("tags: [asymmetry-radar]")
    lines.append("---")
    return "\n".join(lines)


def _generate_md_from_row(row: dict) -> str:
    """Build a full markdown document from raw Supabase columns."""
    ticker = row.get("ticker", "UNKNOWN")
    company_name = row.get("company_name", "")
    tier = row.get("tier", "")
    thesis = row.get("thesis", "")
    overall_score = row.get("overall_score", "")
    floor_price = row.get("floor_price")
    target_price = row.get("target_price")
    bull_price = row.get("bull_price", row.get("bull_ceiling"))
    price = row.get("price") or row.get("entry_price")
    business_model = row.get("business_model", "")
    moat = row.get("moat", "")
    asymmetry_verdict = row.get("asymmetry_verdict", "")
    invalidation_trigger = row.get("invalidation_trigger", "")
    scores = row.get("scores") or {}
    catalysts = row.get("catalysts") or []
    red_flags = row.get("red_flags") or []
    peers = row.get("peers") or []

    heading = f"# {ticker}"
    if company_name:
        heading = f"# {ticker} — {company_name}"

    sections = [_frontmatter(row), "", heading, ""]

    # Tier badge
    if tier:
        tier_label = {1: "Tier 1 — Exceptional Asymmetry",
                      2: "Tier 2 — High Conviction",
                      3: "Tier 3 — Early Watchlist"}.get(int(tier), f"Tier {tier}")
        sections += [f"**{tier_label}**", ""]

    # Thesis
    if thesis:
        sections += ["## Thesis", "", thesis, ""]

    # Scores
    if scores or overall_score != "":
        sections += ["## Conviction Scores", ""]
        if isinstance(scores, dict):
            for dim, val in scores.items():
                label = dim.replace("_", " ").title()
                bar = "█" * round((val or 0)) + "░" * (10 - round((val or 0)))
                sections.append(f"- **{label}**: {bar}  {val}/10")
        if overall_score != "":
            sections.append(f"- **Overall**: {overall_score}/100")
        sections.append("")

    # Asymmetry model
    if any(x is not None for x in [price, floor_price, target_price, bull_price]):
        sections += ["## Asymmetry Model", ""]
        if price is not None:
            sections.append(f"- Entry:  ${price:,.2f}")
        if floor_price is not None:
            sections.append(f"- Floor:  ${float(floor_price):,.2f}")
        if target_price is not None:
            sections.append(f"- Target: ${float(target_price):,.2f}")
        if bull_price is not None:
            sections.append(f"- Bull:   ${float(bull_price):,.2f}")
        sections.append("")

    # Business model
    if business_model:
        sections += ["## Business Model", "", business_model, ""]

    # Moat
    if moat:
        sections += ["## Moat", "", moat, ""]

    # Catalysts
    if catalysts:
        sections += ["## Catalysts (Next 12 Months)", ""]
        for i, c in enumerate(catalysts, 1):
            if isinstance(c, dict):
                event = c.get("event", "")
                timing = c.get("timing", "")
                line = f"{i}. **{event}**"
                if timing:
                    line += f" — {timing}"
                sections.append(line)
            else:
                sections.append(f"{i}. {c}")
        sections.append("")

    # Peers
    if peers:
        sections += ["## Peer Comparison", ""]
        header = "| Metric | " + " | ".join(
            p.get("name", f"Peer {i+1}") for i, p in enumerate(peers)
        ) + " |"
        divider = "|---|" + "---|" * len(peers)
        sections += [header, divider]
        metrics = [
            ("P/S (TTM)", "ps_ttm"),
            ("Gross Margin", "gross_margin"),
            ("YoY Rev Growth", "rev_growth"),
        ]
        for label, key in metrics:
            vals = [str(p.get(key, "")) for p in peers]
            sections.append(f"| {label} | " + " | ".join(vals) + " |")
        sections.append("")

    # Red flags
    if red_flags:
        sections += ["## Bear Case", ""]
        severity_icon = {"High": "🔴", "Medium": "🟡", "Low": "🟢"}
        for i, rf in enumerate(red_flags, 1):
            if isinstance(rf, dict):
                sev = rf.get("severity", "Medium")
                icon = severity_icon.get(sev, "🟡")
                title = rf.get("title", f"Red Flag #{i}")
                desc = rf.get("description", "")
                source = rf.get("source", "")
                sections.append(f"### {icon} Red Flag #{i} — {title} ({sev})")
                if desc:
                    sections += ["", desc]
                if source:
                    sections += ["", f"*Source: {source}*"]
                sections.append("")
            else:
                sections += [f"### Red Flag #{i}", "", str(rf), ""]

    # Asymmetry verdict
    if asymmetry_verdict:
        sections += ["## Asymmetry Verdict", "", asymmetry_verdict, ""]

    # Invalidation trigger
    if invalidation_trigger:
        sections += [
            "## Invalidation Trigger",
            "",
            f"> {invalidation_trigger}",
            "",
        ]

    return "\n".join(sections)


def _opportunity_filename(row: dict) -> str:
    ticker = row.get("ticker", "UNKNOWN").upper()
    raw = row.get("created_at") or row.get("date", "")
    date_str = _fmt_date(raw).replace("-", "") if raw else datetime.utcnow().strftime("%Y%m%d")
    return f"{ticker}_{date_str}.md"


# ── Index builder ─────────────────────────────────────────────────────────────

def _build_index(rows: list[dict]) -> str:
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Asymmetry Opportunity Radar",
        "",
        f"*Last synced: {now}*",
        "",
        "## Active Opportunities",
        "",
        "```dataview",
        "TABLE tier, overall_score, target_price, floor_price",
        'FROM "opportunities"',
        'WHERE status = "active"',
        "SORT overall_score DESC",
        "```",
        "",
        "*Run `python3 tools/sync_vault.py` to update from Supabase.*",
        "",
    ]

    # Group by tier for a human-readable summary
    tier_groups: dict[int, list[dict]] = {}
    for row in rows:
        t = int(row.get("tier") or 0)
        tier_groups.setdefault(t, []).append(row)

    tier_labels = {
        1: "Tier 1 — Exceptional Asymmetry",
        2: "Tier 2 — High Conviction",
        3: "Tier 3 — Early Watchlist",
        0: "Untiered",
    }

    for tier_num in sorted(tier_groups.keys(), key=lambda x: (x == 0, x)):
        label = tier_labels.get(tier_num, f"Tier {tier_num}")
        lines += [f"### {label}", ""]
        lines += ["| Ticker | Score | Target | Floor | Status |",
                  "|---|---|---|---|---|"]
        for row in sorted(tier_groups[tier_num],
                          key=lambda r: r.get("overall_score") or 0,
                          reverse=True):
            ticker = row.get("ticker", "?")
            score = row.get("overall_score", "")
            target = f"${row['target_price']:,.2f}" if row.get("target_price") else ""
            floor_ = f"${row['floor_price']:,.2f}" if row.get("floor_price") else ""
            status = row.get("status", "active")
            fname = _opportunity_filename(row)
            lines.append(
                f"| [[opportunities/{fname}|{ticker}]] | {score} | {target} | {floor_} | {status} |"
            )
        lines.append("")

    return "\n".join(lines)


# ── Memory sync ───────────────────────────────────────────────────────────────

def _build_memory_md(record: dict | None) -> str:
    if record is None:
        return (
            "---\n"
            "updated: \n"
            "scan_count: 0\n"
            "---\n\n"
            "# Agent Memory Bank\n\n"
            "## Active Themes\n"
            "*(populated by radar scans)*\n\n"
            "## Pattern Library\n"
            "*(populated by radar scans)*\n\n"
            "## Sector Context\n"
            "*(populated by radar scans)*\n\n"
            "## Recent Outcomes\n"
            "*(populated by radar scans)*\n"
        )

    value = record.get("value") or {}
    if isinstance(value, str):
        # Stored as JSON string
        import json
        try:
            value = json.loads(value)
        except Exception:
            value = {"raw": value}

    updated = _fmt_date(record.get("updated_at") or record.get("created_at", ""))
    scan_count = value.get("scan_count", 0)

    lines = [
        "---",
        f"updated: {updated}",
        f"scan_count: {scan_count}",
        "---",
        "",
        "# Agent Memory Bank",
        "",
    ]

    sections = [
        ("active_themes", "Active Themes"),
        ("pattern_library", "Pattern Library"),
        ("sector_context", "Sector Context"),
        ("recent_outcomes", "Recent Outcomes"),
    ]

    for key, heading in sections:
        content = value.get(key)
        lines += [f"## {heading}", ""]
        if content:
            if isinstance(content, list):
                for item in content:
                    lines.append(f"- {item}")
            elif isinstance(content, dict):
                for k, v in content.items():
                    lines.append(f"- **{k}**: {v}")
            else:
                lines.append(str(content))
        else:
            lines.append("*(populated by radar scans)*")
        lines.append("")

    # Dump any extra top-level keys not already handled
    known_keys = {k for k, _ in sections} | {"scan_count", "raw"}
    extras = {k: v for k, v in value.items() if k not in known_keys}
    if extras:
        lines += ["## Additional Context", ""]
        for k, v in extras.items():
            lines.append(f"- **{k}**: {v}")
        lines.append("")

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    client = _get_client()

    # ── Fetch opportunities ────────────────────────────────────────────────────
    print("Fetching radar_opportunities …")
    resp = client.table("radar_opportunities").select("*").execute()
    rows: list[dict] = resp.data or []
    print(f"  Found {len(rows)} row(s)")

    # Ensure output dirs exist
    OPP_DIR.mkdir(parents=True, exist_ok=True)
    MEM_DIR.mkdir(parents=True, exist_ok=True)

    written_opps = 0
    for row in rows:
        fname = _opportunity_filename(row)
        dest = OPP_DIR / fname

        # Use stored report_md if present; otherwise generate from columns
        report_md = row.get("report_md")
        if report_md:
            content = _frontmatter(row) + "\n\n" + report_md
        else:
            content = _generate_md_from_row(row)

        dest.write_text(content, encoding="utf-8")
        written_opps += 1
        ticker = row.get("ticker", "?")
        print(f"  Wrote {fname}  ({len(content):,} chars)  [{ticker}]")

    # ── Write index ────────────────────────────────────────────────────────────
    index_path = VAULT_DIR / "_index.md"
    index_content = _build_index(rows)
    index_path.write_text(index_content, encoding="utf-8")
    print(f"  Wrote _index.md  ({len(index_content):,} chars)")

    # ── Fetch agent memory ─────────────────────────────────────────────────────
    print("Fetching radar_memory …")
    mem_record = None
    try:
        mem_resp = (
            client.table("radar_memory")
            .select("*")
            .eq("key", "agent_context")
            .limit(1)
            .execute()
        )
        if mem_resp.data:
            mem_record = mem_resp.data[0]
            print("  Found agent_context record")
        else:
            print("  No agent_context record found — writing placeholder")
    except Exception as exc:
        print(f"  Warning: could not fetch radar_memory ({exc}) — writing placeholder")

    mem_content = _build_memory_md(mem_record)
    mem_path = MEM_DIR / "agent_context.md"
    mem_path.write_text(mem_content, encoding="utf-8")
    print(f"  Wrote _memory/agent_context.md  ({len(mem_content):,} chars)")

    # ── Summary ────────────────────────────────────────────────────────────────
    print()
    print("── Vault sync complete ─────────────────────────────────────────────")
    print(f"  Opportunities synced : {written_opps}")
    print(f"  Index updated        : vault/_index.md")
    print(f"  Memory updated       : vault/_memory/agent_context.md")
    print(f"  Vault root           : {VAULT_DIR}")


if __name__ == "__main__":
    main()

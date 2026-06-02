// Function: weekly-digest | Project: jmtkygwvmrolfvwueggs | Version: 1
// Schedule: every Monday at 09:00 UTC via pg_cron
// Generates: comprehensive weekly intelligence briefing
//   - Opportunity leaderboard (last 30 days, score ≥ 75)
//   - Portfolio positions (from portfolio_positions if exists)
//   - Market conditions (live VIX + Fear & Greed)
//   - DCA reserve status
//   - Week-ahead reminder
//
// Sends: ntfy notification + Obsidian vault markdown entry
//
// Manual trigger: POST {} or GET
// Test:           POST {"test":true}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ── Constants ─────────────────────────────────────────────────────────────────

const NTFY_TOPIC = "asymmetry-radar";
const YF_UA      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// DCA config (mirrors market-pulse)
const MONTHLY_TOTAL    = 1500;
const RESERVE_PCT      = 0.20;
const BASE_DCA         = Math.round(MONTHLY_TOTAL * (1 - RESERVE_PCT));   // $1,200
const MONTHLY_RESERVE  = Math.round(MONTHLY_TOTAL * RESERVE_PCT);          // $300

const VIX_FEAR         = 30;
const VIX_CRASH        = 40;
const FG_EXTREME_FEAR  = 25;

// ── Supabase client ───────────────────────────────────────────────────────────

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface Opportunity {
  id: string;
  ticker: string;
  tier: number;
  overall_score: number;
  thesis: string | null;
  report_url: string | null;
  created_at: string;
  data_snapshot: Record<string, unknown> | null;
}

interface Position {
  id: string;
  ticker: string;
  shares: number;
  avg_cost: number;
  entry_date: string | null;
  thesis_score: number | null;
  notes: string | null;
  status: string | null;
}

interface VixData    { value: number; prev_close: number }
interface FGData     { score: number; rating: string }
interface DCASignal  { level: "NONE" | "FEAR" | "CRASH"; reason: string }

// ── Market data fetchers ──────────────────────────────────────────────────────

async function getVix(): Promise<VixData | null> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=5d&interval=1d",
      { headers: { "User-Agent": YF_UA, "Accept": "application/json" } }
    );
    if (!res.ok) return null;
    const j      = await res.json();
    const meta   = j?.chart?.result?.[0]?.meta ?? {};
    const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return {
      value:      meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0,
      prev_close: meta.chartPreviousClose  ?? closes[closes.length - 2] ?? 0,
    };
  } catch { return null; }
}

async function getFearGreed(): Promise<FGData | null> {
  try {
    const res = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      { headers: { "User-Agent": YF_UA, "Accept": "application/json", "Referer": "https://www.cnn.com/" } }
    );
    if (!res.ok) return null;
    const j   = await res.json();
    const cur = j?.fear_and_greed;
    if (!cur?.score) return null;
    return { score: Math.round(cur.score), rating: cur.rating ?? "" };
  } catch { return null; }
}

// ── DCA signal logic ──────────────────────────────────────────────────────────

function getDCASignal(vix: number, fg: number): DCASignal {
  if (vix >= VIX_CRASH) {
    return { level: "CRASH", reason: `VIX ${vix.toFixed(1)} ≥ ${VIX_CRASH} — crash protocol active` };
  }
  if (vix >= VIX_FEAR) {
    return { level: "FEAR", reason: `VIX ${vix.toFixed(1)} ≥ ${VIX_FEAR} — fear spike` };
  }
  if (fg <= FG_EXTREME_FEAR) {
    return { level: "FEAR", reason: `Fear & Greed ${fg} — extreme fear without VIX spike` };
  }
  return { level: "NONE", reason: "Markets calm — base DCA only" };
}

// ── Supabase queries ──────────────────────────────────────────────────────────

async function getOpportunities(): Promise<Opportunity[]> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("radar_opportunities")
      .select("id, ticker, tier, overall_score, thesis, report_url, created_at, data_snapshot")
      .gte("overall_score", 75)
      .gte("created_at", thirtyDaysAgo)
      .order("overall_score", { ascending: false });
    if (error) { console.error("[opportunities]", error.message); return []; }
    return (data ?? []) as Opportunity[];
  } catch (e) { console.error("[opportunities]", String(e)); return []; }
}

async function getPortfolioPositions(): Promise<Position[] | null> {
  try {
    const { data, error } = await supabase
      .from("portfolio_positions")
      .select("id, ticker, shares, avg_cost, entry_date, thesis_score, notes, status")
      .order("entry_date", { ascending: false });
    if (error) {
      // Table may not exist yet — treat gracefully
      if (error.message?.includes("does not exist") || error.code === "42P01") return null;
      console.error("[portfolio]", error.message);
      return null;
    }
    return (data ?? []) as Position[];
  } catch (e) { console.error("[portfolio]", String(e)); return null; }
}

// ── GitHub vault push ─────────────────────────────────────────────────────────

async function pushToGitHub(path: string, content: string, message: string): Promise<void> {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) return;
  const repo   = Deno.env.get("GITHUB_REPO")   ?? "maple-maker/aegis-intel-vault";
  const branch = Deno.env.get("GITHUB_BRANCH") ?? "main";
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const hdrs   = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "asymmetry-radar",
    "Content-Type": "application/json",
  };
  let sha: string | undefined;
  try {
    const r = await fetch(`${apiUrl}?ref=${branch}`, { headers: hdrs });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* new file */ }
  const payload: Record<string, unknown> = {
    message, branch,
    content: btoa(unescape(encodeURIComponent(content))),
  };
  if (sha) payload.sha = sha;
  try {
    const res = await fetch(apiUrl, { method: "PUT", headers: hdrs, body: JSON.stringify(payload) });
    if (!res.ok) {
      console.error(`[github] PUT ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } catch (e) { console.error("[github]", String(e)); }
}

// ── ntfy notification ─────────────────────────────────────────────────────────

async function notify(title: string, body: string, priority = 4): Promise<void> {
  try {
    await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message: body, priority, tags: ["newspaper"] }),
    });
  } catch (e) { console.error("[ntfy]", String(e)); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string | null | undefined, len: number): string {
  if (!s) return "";
  return s.length <= len ? s : s.slice(0, len - 1) + "…";
}

function tierLabel(t: number): string {
  if (t === 1) return "T1";
  if (t === 2) return "T2";
  return "T3";
}

function vixStatus(vix: number): string {
  if (vix >= VIX_CRASH) return "🚨 Crash Zone";
  if (vix >= VIX_FEAR)  return "⚠️ Fear Zone";
  if (vix >= 20)        return "😟 Elevated";
  return "✅ Calm";
}

function dcaSignalLabel(signal: DCASignal): string {
  if (signal.level === "CRASH") return `CRASH — deploy +$${(BASE_DCA * 2).toLocaleString()} NOW`;
  if (signal.level === "FEAR")  return `FEAR — deploy +$${BASE_DCA.toLocaleString()} NOW`;
  return `NONE — base $${BASE_DCA.toLocaleString()} only`;
}

/** Months elapsed since January 1 of the current year (0 = still in January) */
function monthsSinceJanuary(now: Date): number {
  return now.getMonth(); // 0-based → months elapsed since Jan 1
}

// ── ntfy message formatter ────────────────────────────────────────────────────

function formatDigestMessage(
  date: string,
  opportunities: Opportunity[],
  positions: Position[] | null,
  vix: VixData | null,
  fg: FGData | null,
  signal: DCASignal,
  now: Date,
): string {
  const lines: string[] = [];

  // Header
  lines.push("📋 WEEKLY INTELLIGENCE DIGEST");
  lines.push("━".repeat(32));
  lines.push(`Week of ${date}`);
  lines.push("");

  // ── Opportunity leaderboard ──────────────────────────────────────────────
  lines.push("🏆 ACTIVE OPPORTUNITIES (last 30 days)");
  if (opportunities.length === 0) {
    lines.push("  (none — radar found no qualifying opportunities)");
  } else {
    opportunities.forEach((opp, i) => {
      const rank    = `#${i + 1}`.padEnd(3);
      const ticker  = `$${opp.ticker}`.padEnd(7);
      const tier    = tierLabel(opp.tier).padEnd(3);
      const score   = `${opp.overall_score}/100`;
      const thesis  = truncate(opp.thesis, 80);
      lines.push(`  ${rank} ${ticker} ${tier} ${score}  ${thesis}`);
      if (opp.report_url) {
        lines.push(`       📄 ${opp.report_url}`);
      }
    });
  }
  lines.push("");

  // ── Market conditions ─────────────────────────────────────────────────────
  lines.push("📈 MARKET CONDITIONS");
  const vixVal   = vix ? vix.value.toFixed(1) : "N/A";
  const fgScore  = fg ? fg.score : null;
  const fgRating = fg ? fg.rating : "N/A";
  lines.push(`  VIX: ${vixVal}  ${vix ? vixStatus(vix.value) : "—"}`);
  lines.push(`  Fear & Greed: ${fgScore ?? "N/A"} — ${fgRating}`);
  lines.push(`  DCA Signal: ${dcaSignalLabel(signal)}`);
  lines.push("");

  // ── Portfolio ─────────────────────────────────────────────────────────────
  if (positions === null) {
    lines.push("💼 PORTFOLIO");
    lines.push("  No positions table yet — add portfolio_positions to track holdings");
  } else {
    const active = positions.filter(p => !p.status || p.status === "active");
    lines.push(`💼 PORTFOLIO (${active.length} position${active.length !== 1 ? "s" : ""})`);
    if (active.length === 0) {
      lines.push("  No positions logged yet");
    } else {
      active.forEach(pos => {
        const cost   = `$${pos.avg_cost.toFixed(2)}`;
        const status = pos.status ? `[${pos.status}]` : "[active]";
        lines.push(`  $${pos.ticker}  ${pos.shares} shares @ ${cost}  ${status}`);
      });
      lines.push("  ℹ️  P&L requires Plaid — coming soon");
    }
  }
  lines.push("");

  // ── DCA reserve status ────────────────────────────────────────────────────
  const monthsElapsed         = monthsSinceJanuary(now);
  const dryPowderAccumulated  = monthsElapsed * MONTHLY_RESERVE;

  lines.push("💰 DCA RESERVE STATUS");
  lines.push(`  Monthly saving: $${MONTHLY_RESERVE} → HYSA`);
  lines.push(`  Months elapsed (YTD): ${monthsElapsed}`);
  lines.push(`  Dry powder accumulated (est.): ~$${dryPowderAccumulated.toLocaleString()}`);
  lines.push(`  Rules: VIX≥${VIX_FEAR} deploy +$${BASE_DCA.toLocaleString()} | VIX≥${VIX_CRASH} deploy +$${(BASE_DCA * 2).toLocaleString()}`);
  lines.push("");

  // ── Week ahead ────────────────────────────────────────────────────────────
  // Compute next radar scan time (07:00, 13:00, 19:00 UTC)
  const scanHours = [7, 13, 19];
  const currentHour = now.getUTCHours();
  const nextScanHour = scanHours.find(h => h > currentHour) ?? scanHours[0];
  const nextScan = `${nextScanHour.toString().padStart(2, "0")}:00`;

  lines.push("📅 STAY SHARP");
  lines.push("  Earnings monitor runs daily — alerts 48hr before catalysts");
  lines.push(`  Radar scans 3x daily — next: ${nextScan} UTC`);

  return lines.join("\n");
}

// ── Obsidian vault markdown generator ────────────────────────────────────────

function generateMarkdown(
  date: string,
  opportunities: Opportunity[],
  positions: Position[] | null,
  vix: VixData | null,
  fg: FGData | null,
  signal: DCASignal,
  now: Date,
): string {
  const vixVal   = vix ? vix.value.toFixed(1) : "N/A";
  const fgScore  = fg ? fg.score : "N/A";
  const fgRating = fg ? fg.rating : "N/A";

  // Frontmatter
  const fm = [
    "---",
    `date: ${date}`,
    `vix: ${vixVal}`,
    `fear_greed: ${fgScore}`,
    `dca_signal: ${signal.level}`,
    `opportunities_count: ${opportunities.length}`,
    `tags: [weekly-digest, market-pulse, dca-signal]`,
    "---",
    "",
  ].join("\n");

  // Opportunities table
  let oppsSection: string;
  if (opportunities.length === 0) {
    oppsSection = "*No qualifying opportunities in the last 30 days.*";
  } else {
    const header = "| Rank | Ticker | Tier | Score | Thesis | Report |";
    const sep    = "|------|--------|------|-------|--------|--------|";
    const rows   = opportunities.map((opp, i) => {
      const thesis = (truncate(opp.thesis, 80) ?? "").replace(/\|/g, "\\|");
      const report = opp.report_url ? `[View](${opp.report_url})` : "—";
      return `| #${i + 1} | $${opp.ticker} | T${opp.tier} | ${opp.overall_score}/100 | ${thesis} | ${report} |`;
    });
    oppsSection = [header, sep, ...rows].join("\n");
  }

  // Market conditions table
  const marketTable = [
    "| Indicator | Value | Status |",
    "|-----------|-------|--------|",
    `| VIX | ${vixVal} | ${vix ? vixStatus(vix.value) : "N/A"} |`,
    `| Fear & Greed | ${fgScore}/100 | ${fgRating} |`,
    `| DCA Signal | ${signal.level} | ${signal.reason} |`,
  ].join("\n");

  // Portfolio table
  let portfolioSection: string;
  if (positions === null) {
    portfolioSection = "*portfolio_positions table not yet created.*";
  } else {
    const active = positions.filter(p => !p.status || p.status === "active");
    if (active.length === 0) {
      portfolioSection = "*No positions logged yet.*";
    } else {
      const header = "| Ticker | Shares | Avg Cost | Entry Date | Score | Status | Notes |";
      const sep    = "|--------|--------|----------|------------|-------|--------|-------|";
      const rows   = active.map(pos => {
        const notes     = (pos.notes ?? "—").replace(/\|/g, "\\|");
        const entryDate = pos.entry_date ? pos.entry_date.slice(0, 10) : "—";
        return `| $${pos.ticker} | ${pos.shares} | $${pos.avg_cost.toFixed(2)} | ${entryDate} | ${pos.thesis_score ?? "—"} | ${pos.status ?? "active"} | ${notes} |`;
      });
      portfolioSection = [header, sep, ...rows].join("\n");
      portfolioSection += "\n\n> P&L requires Plaid integration — coming soon.";
    }
  }

  // DCA section
  const monthsElapsed         = monthsSinceJanuary(now);
  const dryPowderAccumulated  = monthsElapsed * MONTHLY_RESERVE;
  const dcaSection = [
    "| Item | Value |",
    "|------|-------|",
    `| Monthly base invest | $${BASE_DCA.toLocaleString()} |`,
    `| Monthly HYSA reserve | $${MONTHLY_RESERVE.toLocaleString()} |`,
    `| Months elapsed (YTD) | ${monthsElapsed} |`,
    `| Est. dry powder accumulated | ~$${dryPowderAccumulated.toLocaleString()} |`,
    `| Deploy trigger (fear) | VIX ≥ ${VIX_FEAR} → +$${BASE_DCA.toLocaleString()} |`,
    `| Deploy trigger (crash) | VIX ≥ ${VIX_CRASH} → +$${(BASE_DCA * 2).toLocaleString()} |`,
  ].join("\n");

  return `${fm}# Weekly Intelligence Digest — ${date}

> Generated by Asymmetry Opportunity Radar · ${new Date().toUTCString()}

---

## 🏆 Active Opportunities (Last 30 Days — Score ≥ 75)

${oppsSection}

---

## 📈 Market Conditions

${marketTable}

---

## 💼 Portfolio Positions

${portfolioSection}

---

## 💰 DCA Reserve Status

${dcaSection}

---

## 📅 Week Ahead

- Earnings monitor runs daily — 48hr alerts before catalyst windows
- Radar scans 3x daily (07:00, 13:00, 19:00 UTC)
- This digest is the strategic overview; earnings-monitor handles specific alerts

---

*Asymmetry Opportunity Radar · ${date} · Not investment advice.*
`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const now      = new Date();
  const body     = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const testMode = body.test === true;

  // Day-of-week guard: scheduled pg_cron fires on Monday — manual POST/GET always allowed
  // Only block if this appears to be an unintentional GET on a non-Monday (not test mode)
  const isMonday = now.getUTCDay() === 1;
  if (!testMode && req.method === "GET" && !isMonday) {
    return new Response(
      JSON.stringify({
        ok: false,
        skipped: true,
        reason: "Not Monday — weekly digest only runs on Mondays (use POST {} to force, or POST {\"test\":true})",
        day: now.getUTCDay(),
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const date = now.toISOString().slice(0, 10);

  // Fetch all data in parallel
  const [vixData, fgData, opportunities, positions] = await Promise.all([
    getVix(),
    getFearGreed(),
    getOpportunities(),
    getPortfolioPositions(),
  ]);

  const vixValue = vixData?.value ?? 0;
  const fgScore  = fgData?.score  ?? 50;
  const signal   = getDCASignal(vixValue, fgScore);

  // Generate content
  const ntfyMessage = formatDigestMessage(date, opportunities, positions, vixData, fgData, signal, now);
  const mdContent   = generateMarkdown(date, opportunities, positions, vixData, fgData, signal, now);

  // Push markdown to GitHub → Obsidian vault
  await pushToGitHub(
    `vault/digests/${date}-weekly.md`,
    mdContent,
    `digest: weekly intelligence briefing [${date}]`
  );

  // Send ntfy notification
  const oppCount = opportunities.length;
  const title = `📋 Weekly Digest — ${date} | ${oppCount} opp${oppCount !== 1 ? "s" : ""} | VIX ${vixValue > 0 ? vixValue.toFixed(1) : "N/A"}`;
  await notify(title, ntfyMessage, 4);

  const activePositions = positions === null
    ? "table_missing"
    : positions.filter(p => !p.status || p.status === "active").length;

  console.log(
    `[weekly-digest] ${date} — opps=${oppCount} | positions=${activePositions} | vix=${vixValue > 0 ? vixValue.toFixed(1) : "N/A"} | dca=${signal.level}`
  );

  return new Response(
    JSON.stringify({
      ok: true,
      date,
      opportunities_surfaced: oppCount,
      portfolio_positions: activePositions,
      vix: vixData?.value ?? null,
      fear_greed: fgData?.score ?? null,
      dca_signal: signal.level,
      vault_path: `vault/digests/${date}-weekly.md`,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } }
  );
});

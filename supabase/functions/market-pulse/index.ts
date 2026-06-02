// Function: market-pulse | Project: jmtkygwvmrolfvwueggs | Version: 1
// Schedule: daily at 14:00 UTC (9am ET) and 21:00 UTC (4pm ET close check)
// Monitors: VIX + CNN Fear & Greed Index
// Alerts: only when VIX ≥ 30 or Fear & Greed ≤ 25
// DCA model: $1,500/month — $1,200 base + $300 reserve ($3,600 annual dry powder)
//
// Manual trigger: POST {} or GET
// Test:           POST {"test":true}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const NTFY_TOPIC  = "asymmetry-radar";
const YF_UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const ANON_KEY    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptdGt5Z3d2bXJvbGZ2d3VlZ2dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzAxODUsImV4cCI6MjA5NTkwNjE4NX0.JUbsLc_KHHdfXWDSAl9Rf00Da-axpSj4Nw4DvXGNBvk";

// ── DCA config ────────────────────────────────────────────────────────────────
const MONTHLY_TOTAL   = 1500;
const RESERVE_PCT     = 0.20;
const BASE_DCA        = Math.round(MONTHLY_TOTAL * (1 - RESERVE_PCT));   // $1,200
const MONTHLY_RESERVE = Math.round(MONTHLY_TOTAL * RESERVE_PCT);          // $300
const ANNUAL_RESERVE  = MONTHLY_RESERVE * 12;                              // $3,600

const VIX_FEAR        = 30;
const VIX_CRASH       = 40;
const FG_EXTREME_FEAR = 25;
const FG_FEAR         = 45;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── VIX fetch ─────────────────────────────────────────────────────────────────

async function getVix(): Promise<{ value: number; prev_close: number } | null> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=2d&interval=1d",
      { headers: { "User-Agent": YF_UA, "Accept": "application/json" } }
    );
    if (!res.ok) return null;
    const j    = await res.json();
    const meta = j?.chart?.result?.[0]?.meta ?? {};
    const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return {
      value:      meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0,
      prev_close: meta.chartPreviousClose ?? closes[closes.length - 2] ?? 0,
    };
  } catch { return null; }
}

// ── Fear & Greed fetch (CNN) ──────────────────────────────────────────────────

interface FGData { score: number; rating: string; prev_score: number; prev_rating: string }

async function getFearGreed(): Promise<FGData | null> {
  try {
    const res = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      { headers: { "User-Agent": YF_UA, "Accept": "application/json", "Referer": "https://www.cnn.com/" } }
    );
    if (!res.ok) return null;
    const j   = await res.json();
    const cur = j?.fear_and_greed;
    const prev = j?.fear_and_greed_historical?.data?.[1];   // yesterday
    if (!cur?.score) return null;
    return {
      score:       Math.round(cur.score),
      rating:      cur.rating ?? "",
      prev_score:  prev ? Math.round(prev.y) : cur.score,
      prev_rating: prev?.rating ?? cur.rating ?? "",
    };
  } catch { return null; }
}

// ── S&P 500 fetch ─────────────────────────────────────────────────────────────

async function getSP500(): Promise<{ value: number; change_pct: number } | null> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=2d&interval=1d",
      { headers: { "User-Agent": YF_UA, "Accept": "application/json" } }
    );
    if (!res.ok) return null;
    const j    = await res.json();
    const meta = j?.chart?.result?.[0]?.meta ?? {};
    const prev = meta.chartPreviousClose ?? 0;
    const cur  = meta.regularMarketPrice ?? 0;
    return { value: cur, change_pct: prev ? +((cur - prev) / prev * 100).toFixed(2) : 0 };
  } catch { return null; }
}

// ── Sector dislocation scan ───────────────────────────────────────────────────

const SECTORS = [
  { etf: "XLK",  name: "Technology" },
  { etf: "XLF",  name: "Financials" },
  { etf: "XLV",  name: "Health Care" },
  { etf: "XLE",  name: "Energy" },
  { etf: "XLC",  name: "Comm Svcs" },
  { etf: "XLY",  name: "Cons Discret" },
  { etf: "XLP",  name: "Cons Staples" },
  { etf: "XLI",  name: "Industrials" },
  { etf: "XLB",  name: "Materials" },
  { etf: "XLRE", name: "Real Estate" },
  { etf: "XLU",  name: "Utilities" },
];

interface SectorData { etf: string; name: string; price: number; year_high: number; pct_from_high: number }

async function getSectorData(): Promise<SectorData[]> {
  const out: SectorData[] = [];
  for (const s of SECTORS) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${s.etf}?range=1y&interval=1d`,
        { headers: { "User-Agent": YF_UA, "Accept": "application/json" } }
      );
      if (!res.ok) continue;
      const j    = await res.json();
      const meta = j?.chart?.result?.[0]?.meta ?? {};
      const price  = meta.regularMarketPrice ?? 0;
      const yHigh  = meta.fiftyTwoWeekHigh   ?? 0;
      if (!price || !yHigh) continue;
      out.push({ ...s, price, year_high: yHigh, pct_from_high: +((price - yHigh) / yHigh * 100).toFixed(1) });
    } catch { /* skip */ }
  }
  return out;
}

// ── DCA signal logic ──────────────────────────────────────────────────────────

interface DCASignal {
  level:       "NONE" | "FEAR" | "CRASH";
  extra_deploy: number;
  total_buy:   number;
  reason:      string;
}

function getDCASignal(vix: number, fg: number): DCASignal {
  if (vix >= VIX_CRASH) {
    return {
      level: "CRASH", extra_deploy: BASE_DCA * 2, total_buy: BASE_DCA + BASE_DCA * 2,
      reason: `VIX ${vix.toFixed(1)} ≥ ${VIX_CRASH} — full crash protocol`,
    };
  }
  if (vix >= VIX_FEAR) {
    return {
      level: "FEAR", extra_deploy: BASE_DCA, total_buy: BASE_DCA + BASE_DCA,
      reason: `VIX ${vix.toFixed(1)} ≥ ${VIX_FEAR} — fear spike`,
    };
  }
  if (fg <= FG_EXTREME_FEAR) {
    return {
      level: "FEAR", extra_deploy: BASE_DCA, total_buy: BASE_DCA + BASE_DCA,
      reason: `Fear & Greed ${fg} — Extreme Fear without VIX spike`,
    };
  }
  return { level: "NONE", extra_deploy: 0, total_buy: BASE_DCA, reason: "Markets calm — base DCA only" };
}

// ── GitHub vault push ─────────────────────────────────────────────────────────

async function pushToGitHub(path: string, content: string, message: string): Promise<void> {
  const token  = Deno.env.get("GITHUB_TOKEN");
  if (!token) return;
  const repo   = Deno.env.get("GITHUB_REPO")   ?? "maple-maker/aegis-intel-vault";
  const branch = Deno.env.get("GITHUB_BRANCH") ?? "main";
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const hdrs   = {
    "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github.v3+json",
    "User-Agent": "asymmetry-radar", "Content-Type": "application/json",
  };
  let sha: string | undefined;
  try {
    const r = await fetch(`${apiUrl}?ref=${branch}`, { headers: hdrs });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* new file */ }
  const payload: Record<string, any> = { message, branch, content: btoa(unescape(encodeURIComponent(content))) };
  if (sha) payload.sha = sha;
  await fetch(apiUrl, { method: "PUT", headers: hdrs, body: JSON.stringify(payload) });
}

// ── Notification ──────────────────────────────────────────────────────────────

async function notify(title: string, body: string, priority = 4) {
  await fetch("https://ntfy.sh/", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: NTFY_TOPIC, title, message: body, priority, tags: ["money_with_wings"] }),
  });
}

function fgEmoji(score: number): string {
  if (score <= 25) return "😱";
  if (score <= 45) return "😰";
  if (score <= 55) return "😐";
  if (score <= 75) return "😊";
  return "🤑";
}

function vixEmoji(vix: number): string {
  if (vix >= VIX_CRASH) return "🚨";
  if (vix >= VIX_FEAR)  return "⚠️";
  if (vix >= 20)        return "😟";
  return "✅";
}

function bar10(v: number, max: number): string {
  const filled = Math.round((v / max) * 10);
  return "█".repeat(Math.min(filled, 10)) + "░".repeat(Math.max(0, 10 - filled));
}

function formatAlert(vix: number, fg: FGData | null, sp: { value: number; change_pct: number } | null, signal: DCASignal, sectors: SectorData[]): string {
  const fgScore   = fg?.score ?? 0;
  const fgRating  = fg?.rating ?? "N/A";
  const spVal     = sp ? `$${sp.value.toFixed(0)}` : "N/A";
  const spChg     = sp ? `${sp.change_pct >= 0 ? "+" : ""}${sp.change_pct}%` : "";
  const reserved  = ANNUAL_RESERVE;
  const remaining = Math.max(0, reserved - signal.extra_deploy);

  const lines = [
    signal.level === "CRASH" ? "🚨 MARKET PULSE — CRASH PROTOCOL ACTIVE" :
    signal.level === "FEAR"  ? "⚠️ MARKET PULSE — FEAR SPIKE DETECTED"  :
                               "📊 MARKET PULSE — Daily Check",
    "━".repeat(32),
    "",
    "📈 MARKET CONDITIONS",
    `  VIX:          ${vixEmoji(vix)} ${vix.toFixed(1)}  ${vix >= VIX_CRASH ? "🚨 CRASH ZONE" : vix >= VIX_FEAR ? "⚠️ FEAR ZONE" : vix >= 20 ? "😟 ELEVATED" : "✅ CALM"}`,
    `  Fear & Greed: ${fgEmoji(fgScore)} ${fgScore}/100 — ${fgRating}`,
    `  S&P 500:      ${spVal}  (${spChg})`,
    "",
    "💰 DCA RECOMMENDATION",
    `  Base monthly:    $${BASE_DCA.toLocaleString()} (auto — always)`,
  ];

  if (signal.level === "NONE") {
    lines.push(
      `  Status:          ✅ No extra deployment needed`,
      `  Dry powder:      $${reserved.toLocaleString()} — hold, keep earning interest`,
    );
  } else {
    lines.push(
      `  ⚡ EXTRA DEPLOY:  +$${signal.extra_deploy.toLocaleString()} NOW`,
      `  Total this buy:  $${signal.total_buy.toLocaleString()}`,
      `  Reserve used:    $${signal.extra_deploy.toLocaleString()} of $${reserved.toLocaleString()}`,
      `  Reserve left:    ~$${remaining.toLocaleString()} (keep in HYSA)`,
    );
  }

  lines.push(
    "",
    "📋 STANDING RULES",
    `  Monthly base:   $${BASE_DCA.toLocaleString()} auto-invest (always)`,
    `  Monthly save:   $${MONTHLY_RESERVE} → HYSA dry powder`,
    `  VIX ≥ ${VIX_FEAR}:      deploy +$${BASE_DCA.toLocaleString()} extra`,
    `  VIX ≥ ${VIX_CRASH}:      deploy +$${(BASE_DCA * 2).toLocaleString()} extra`,
    `  F&G ≤ ${FG_EXTREME_FEAR}:      confirms extreme fear — buy`,
    "",
    `📌 SIGNAL: ${signal.reason}`,
  );

  const dislocated = sectors.filter(s => s.pct_from_high <= -15).sort((a, b) => a.pct_from_high - b.pct_from_high);
  if (dislocated.length > 0) {
    lines.push("", "🔍 SECTOR DISLOCATION (≥15% below 52W high — consider buying)");
    for (const s of dislocated) {
      const icon = s.pct_from_high <= -20 ? "🔴" : "⚠️";
      lines.push(`  ${icon} ${(s.etf + " " + s.name).padEnd(20)} ${s.pct_from_high.toFixed(1)}%`);
    }
  }

  return lines.join("\n");
}

function generateMarkdown(
  vix: number, fg: FGData | null, sp: { value: number; change_pct: number } | null,
  signal: DCASignal, date: string, sectors: SectorData[]
): string {
  const fgScore  = fg?.score ?? 0;
  const fgRating = fg?.rating ?? "N/A";
  return `---
date: ${date}
vix: ${vix.toFixed(1)}
fear_greed: ${fgScore}
fear_greed_rating: ${fgRating}
sp500: ${sp?.value?.toFixed(0) ?? ""}
sp500_change_pct: ${sp?.change_pct ?? ""}
dca_signal: ${signal.level}
extra_deploy: ${signal.extra_deploy}
total_buy: ${signal.total_buy}
tags: [market-pulse, dca-signal]
---

# Market Pulse — ${date}

## Conditions

| Indicator | Value | Status |
|---|---|---|
| VIX | ${vix.toFixed(1)} | ${vix >= VIX_CRASH ? "🚨 Crash Zone" : vix >= VIX_FEAR ? "⚠️ Fear Zone" : vix >= 20 ? "Elevated" : "✅ Calm"} |
| Fear & Greed | ${fgScore}/100 | ${fgRating} |
| S&P 500 | $${sp?.value?.toFixed(0) ?? "N/A"} | ${sp ? `${sp.change_pct >= 0 ? "+" : ""}${sp.change_pct}%` : "N/A"} |

## DCA Signal: ${signal.level === "NONE" ? "✅ Hold — Base DCA Only" : signal.level === "FEAR" ? "⚠️ Deploy Extra — Fear Spike" : "🚨 Deploy Max — Crash Protocol"}

${signal.reason}

| Action | Amount |
|---|---|
| Base monthly (auto) | $${BASE_DCA.toLocaleString()} |
| Extra deploy | $${signal.extra_deploy.toLocaleString()} |
| **Total this buy** | **$${signal.total_buy.toLocaleString()}** |
| Reserve remaining | ~$${Math.max(0, ANNUAL_RESERVE - signal.extra_deploy).toLocaleString()} |

## Standing Rules

| Trigger | Action |
|---|---|
| Every month | Auto-invest $${BASE_DCA.toLocaleString()} + save $${MONTHLY_RESERVE} to HYSA |
| VIX ≥ ${VIX_FEAR} | Deploy extra $${BASE_DCA.toLocaleString()} from dry powder |
| VIX ≥ ${VIX_CRASH} | Deploy extra $${(BASE_DCA * 2).toLocaleString()} from dry powder |
| Fear & Greed ≤ ${FG_EXTREME_FEAR} | Confirms extreme fear — supports extra deployment |
| Annual dry powder target | $${ANNUAL_RESERVE.toLocaleString()} ($${MONTHLY_RESERVE}/month to HYSA) |

## Sector Dislocation

| ETF | Sector | Price | 52W High | % From High | Status |
|---|---|---|---|---|---|
${sectors.map(s => `| ${s.etf} | ${s.name} | $${s.price.toFixed(2)} | $${s.year_high.toFixed(2)} | ${s.pct_from_high.toFixed(1)}% | ${s.pct_from_high <= -20 ? "🔴 Deep dislocation" : s.pct_from_high <= -15 ? "⚠️ Dislocated" : "✅ Normal"} |`).join("\n")}

---
*Asymmetry Market Pulse · ${date} · Not investment advice.*
`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const body     = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const testMode = body.test === true;
  const date     = new Date().toISOString().slice(0, 10);

  const [vixData, fgData, spData, sectorData] = await Promise.all([getVix(), getFearGreed(), getSP500(), getSectorData()]);

  const vix        = vixData?.value ?? 0;
  const signal     = getDCASignal(vix, fgData?.score ?? 50);
  const dislocated = sectorData.filter(s => s.pct_from_high <= -15);

  // Always push daily pulse to vault
  const mdContent = generateMarkdown(vix, fgData, spData, signal, date, sectorData);
  await pushToGitHub(
    `vault/market-pulse/${date}.md`, mdContent,
    `pulse: VIX ${vix.toFixed(1)} | F&G ${fgData?.score ?? "?"} | ${signal.level} | ${dislocated.length} sectors dislocated [${date}]`
  );

  // Alert on threshold cross, test mode, or 2+ sectors deeply dislocated
  const shouldAlert = testMode || signal.level !== "NONE" || dislocated.length >= 2;

  if (shouldAlert) {
    const alertText = formatAlert(vix, fgData, spData, signal, sectorData);
    const title = signal.level === "CRASH" ? `🚨 DCA CRASH PROTOCOL — VIX ${vix.toFixed(1)}` :
                  signal.level === "FEAR"  ? `⚠️ DCA FEAR SIGNAL — VIX ${vix.toFixed(1)}`  :
                  dislocated.length >= 2   ? `🔍 SECTOR DISLOCATION — ${dislocated.length} sectors ≥15% off high` :
                                             `📊 Market Pulse — VIX ${vix.toFixed(1)}`;
    await notify(title, alertText, signal.level === "CRASH" ? 5 : signal.level === "FEAR" ? 4 : dislocated.length >= 2 ? 4 : 3);
  }

  return new Response(JSON.stringify({
    ok: true, date, vix, fear_greed: fgData?.score, sp500: spData?.value,
    signal: signal.level, extra_deploy: signal.extra_deploy,
    sectors_dislocated: dislocated.length,
    dislocated_sectors: dislocated.map(s => ({ etf: s.etf, pct_from_high: s.pct_from_high })),
    alerted: shouldAlert,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});

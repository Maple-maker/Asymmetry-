// Deployed via Supabase MCP — see deploy history in AEGIS project
// Function: radar-scan | Project: jmtkygwvmrolfvwueggs | Version: 27
// Schedule: 3x daily via pg_cron (0 7,13,19 * * *) — 7am, 1pm, 7pm UTC
// Data: Yahoo Finance (crumb auth) — all tickers, no API key required
// Reports: HTML stored in radar_opportunities.report_html → served by report-viewer edge fn
//
// Diagnostic: POST {"diag":true}
// Test:       POST {"test":true,"tickers":["CODA"]}
// Add ticker: INSERT INTO radar_watchlist (ticker, notes) VALUES ('TICK', 'reason');

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_KEY   = Deno.env.get("GEMINI_API_KEY");
const VENICE_KEY   = Deno.env.get("VENICE_API_KEY");
const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK_API_KEY");
const NTFY_TOPIC   = "asymmetry-radar";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta";
const YF_UA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptdGt5Z3d2bXJvbGZ2d3VlZ2dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzAxODUsImV4cCI6MjA5NTkwNjE4NX0.JUbsLc_KHHdfXWDSAl9Rf00Da-axpSj4Nw4DvXGNBvk";
const REPORT_BASE  = `https://jmtkygwvmrolfvwueggs.supabase.co/functions/v1/report-viewer?apikey=${ANON_KEY}`;

// ── Position sizing (DCA model: $1,500/mo — $1,200 base + $300 HYSA) ──────────
const DCA_BASE = 1200;

function positionMultiplier(score: number): number {
  if (score >= 90) return 3;
  if (score >= 80) return 2;
  return 1;
}
function positionDollars(score: number): number { return DCA_BASE * positionMultiplier(score); }

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Yahoo Finance auth ────────────────────────────────────────────────────────

interface YFAuth { cookie: string; crumb: string; }

async function getYFAuth(): Promise<YFAuth | null> {
  try {
    const r1 = await fetch("https://fc.yahoo.com", {
      redirect: "follow",
      headers: { "User-Agent": YF_UA, "Accept": "text/html,*/*" },
    });
    const cookie = (r1.headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) return null;
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YF_UA, "Cookie": cookie },
    });
    if (!r2.ok) return null;
    const crumb = await r2.text();
    if (!crumb || crumb.includes("<")) return null;
    return { cookie, crumb };
  } catch { return null; }
}

// ── Market data ───────────────────────────────────────────────────────────────

async function getSnapshot(ticker: string, auth: YFAuth | null) {
  const hdrs: Record<string, string> = {
    "User-Agent": YF_UA, "Accept": "application/json, */*",
    "Referer": "https://finance.yahoo.com/",
    ...(auth ? { "Cookie": auth.cookie } : {}),
  };

  const chartRes = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`,
    { headers: hdrs }
  );
  if (!chartRes.ok) throw new Error(`YF chart ${chartRes.status} for ${ticker}`);
  const chart = await chartRes.json();
  const meta  = chart?.chart?.result?.[0]?.meta ?? {};

  let sd: any = {}, fd: any = {}, ks: any = {}, ins: any[] = [];
  if (auth) {
    try {
      const url =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}` +
        `?modules=summaryDetail,financialData,defaultKeyStatistics,insiderTransactions` +
        `&crumb=${encodeURIComponent(auth.crumb)}`;
      const sr = await fetch(url, { headers: hdrs });
      if (sr.ok) {
        const j = await sr.json();
        const q = j?.quoteSummary?.result?.[0] ?? {};
        sd = q.summaryDetail ?? {};
        fd = q.financialData ?? {};
        ks = q.defaultKeyStatistics ?? {};
        ins = q.insiderTransactions?.transactions ?? [];
      }
    } catch { /* continue with chart-only data */ }
  }

  const buys  = ins.filter((t: any) => (t.transactionText ?? "").toLowerCase().includes("purchase")).length;
  const sells = ins.filter((t: any) => (t.transactionText ?? "").toLowerCase().includes("sale")).length;
  const price = meta.regularMarketPrice as number | null;
  const yh    = meta.fiftyTwoWeekHigh   as number | null;

  return {
    ticker, price,
    market_cap:       meta.marketCap ?? sd.marketCap?.raw ?? null,
    pe:               sd.trailingPE?.raw ?? null,
    year_high:        yh,
    year_low:         meta.fiftyTwoWeekLow as number | null,
    pct_from_high:    yh && price ? +((price - yh) / yh * 100).toFixed(1) : null,
    ps_ttm:           ks.priceToSalesTrailingTwelveMonths?.raw ?? null,
    ev_ebitda:        ks.enterpriseToEbitda?.raw ?? null,
    gross_margin:     fd.grossMargins?.raw ?? null,
    operating_margin: fd.operatingMargins?.raw ?? null,
    revenue_growth:   fd.revenueGrowth?.raw ?? null,
    earnings_growth:  fd.earningsGrowth?.raw ?? null,
    insider_buys: buys, insider_sells: sells,
    insider_signal: buys > sells ? "BUY" : sells > buys ? "SELL" : "NEUTRAL",
  };
}

// ── Quantitative pre-score ────────────────────────────────────────────────────

function quantScore(s: Record<string, any>): number {
  let sc = 0;
  const gr = s.revenue_growth ?? 0;
  if (gr > 0.5) sc += 25; else if (gr > 0.3) sc += 20; else if (gr > 0.15) sc += 12; else if (gr > 0) sc += 5;
  const ps = s.ps_ttm ?? 999;
  if (ps < 2) sc += 20; else if (ps < 5) sc += 15; else if (ps < 10) sc += 8; else if (ps < 20) sc += 3;
  const gm = s.gross_margin ?? 0;
  if (gm > 0.7) sc += 15; else if (gm > 0.5) sc += 10; else if (gm > 0.3) sc += 5;
  if (s.insider_signal === "BUY") sc += 20;
  if (s.insider_signal === "SELL") sc -= 10;
  const ph = s.pct_from_high ?? -100;
  if (ph > -10) sc += 5; else if (ph > -25) sc += 15; else if (ph > -40) sc += 8;
  const mc = s.market_cap ?? 0;
  if (mc < 500_000_000) sc += 5; else if (mc < 2_000_000_000) sc += 2;
  return Math.max(0, Math.min(100, sc));
}

// ── Venice AI (bull advocate, web-search enabled) ─────────────────────────────

async function callVenice(prompt: string): Promise<string> {
  if (!VENICE_KEY) return "";
  try {
    const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${VENICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kimi-k2-5",
        messages: [{ role: "user", content: prompt }],
        venice_parameters: { enable_web_search: "auto" },
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) { console.error(`[venice] ${res.status}: ${(await res.text()).slice(0, 200)}`); return ""; }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } catch (e) { console.error(`[venice] ${String(e)}`); return ""; }
}

// ── DeepSeek (bear advocate, quantitative) ────────────────────────────────────

async function callDeepSeek(prompt: string): Promise<string> {
  if (!DEEPSEEK_KEY) return "";
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${DEEPSEEK_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) { console.error(`[deepseek] ${res.status}: ${(await res.text()).slice(0, 200)}`); return ""; }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } catch (e) { console.error(`[deepseek] ${String(e)}`); return ""; }
}

// ── Multi-model debate: Venice (bull) ↔ DeepSeek (bear), 2 rounds ─────────────

async function runDebate(ticker: string, snap: Record<string, any>): Promise<string> {
  if (!VENICE_KEY && !DEEPSEEK_KEY) return "";

  const price = snap.price != null ? `$${snap.price}` : "N/A";
  const mcap  = snap.market_cap ? `$${(snap.market_cap / 1e6).toFixed(0)}M` : "N/A";
  const rev   = snap.revenue_growth != null ? `${(snap.revenue_growth * 100).toFixed(1)}%` : "N/A";
  const gm    = snap.gross_margin  != null ? `${(snap.gross_margin  * 100).toFixed(1)}%` : "N/A";
  const ps    = snap.ps_ttm  != null ? `${snap.ps_ttm.toFixed(1)}x`  : "N/A";
  const ev    = snap.ev_ebitda != null ? `${snap.ev_ebitda.toFixed(1)}x` : "N/A";
  const ins   = `${snap.insider_signal} (${snap.insider_buys}B/${snap.insider_sells}S)`;
  const db    = `Ticker: $${ticker} | Price: ${price} | Market Cap: ${mcap} | Rev Growth YoY: ${rev} | Gross Margin: ${gm} | P/S TTM: ${ps} | EV/EBITDA: ${ev} | Insider: ${ins}`;

  const bullPrompt =
`You are a BULL ADVOCATE for $${ticker} on the Asymmetry Opportunity Radar.
${db}

Mission: Make the strongest possible BULL case in 200-300 words.
1. Search for recent news, contract wins, regulatory approvals, partnerships (last 90 days)
2. Identify the specific catalyst that could drive 3x+ upside in 12-18 months
3. Explain what the market is missing or undervaluing
4. Point to insider buying, institutional accumulation, or analyst upgrades

Be specific — cite recent evidence. No vague assertions.
End with: BULL TARGET: $XX | TIMEFRAME: XX months | CONVICTION: HIGH/MEDIUM/LOW`;

  const bearPrompt =
`You are a QUANTITATIVE BEAR ANALYST stress-testing $${ticker}.
${db}

Mission: Find every reason this stock is overvalued or at risk in 200-300 words.
1. Is the valuation multiple justified vs peer group? Show the math.
2. Is revenue growth durable or a one-time event?
3. Are margins expanding or compressing?
4. Name the single most dangerous competitive threat in 24 months
5. Flag any balance sheet, customer concentration, or execution risks

Be specific with numbers. Every claim needs data behind it.
End with: BEAR TARGET: $XX | PRIMARY RISK: [one sentence] | VERDICT: AVOID/CAUTION/NEUTRAL`;

  // Round 1: parallel — bull and bear make independent cases
  const [vBull, dsBear] = await Promise.all([callVenice(bullPrompt), callDeepSeek(bearPrompt)]);

  // Round 2: parallel rebuttals — only if both R1 calls returned content
  let vRebuttal = "", dsRebuttal = "";
  if (vBull && dsBear) {
    const rebullPrompt =
`$${ticker} — the bear analyst raised these concerns:

${dsBear}

You are the BULL advocate. Rebut each bear point in 150-200 words.
Search for recent evidence that directly contradicts the bear thesis.
What does the bear miss? Which catalysts does the bear ignore or underweight?`;

    const rebearPrompt =
`$${ticker} — the bull analyst made this case:

${vBull}

You are the BEAR analyst. Stress-test each bull assumption in 150-200 words.
What is the probability each catalyst actually materializes?
Where are the numbers misleading? What does competition look like in 18 months?
Which single bull assumption, if wrong, breaks the entire thesis?`;

    [vRebuttal, dsRebuttal] = await Promise.all([callVenice(rebullPrompt), callDeepSeek(rebearPrompt)]);
  }

  const parts: string[] = [];
  const sep = "\n\n─────────────────────────────\n\n";
  if (vBull)      parts.push(`BULL CASE — Venice (Kimi K2, web-search enabled):\n${vBull}`);
  if (vRebuttal)  parts.push(`BULL REBUTTAL — Venice responding to DeepSeek bear case:\n${vRebuttal}`);
  if (dsBear)     parts.push(`BEAR CASE — DeepSeek (quantitative skeptic):\n${dsBear}`);
  if (dsRebuttal) parts.push(`BEAR REBUTTAL — DeepSeek responding to Venice bull case:\n${dsRebuttal}`);

  return parts.length > 0 ? parts.join(sep) : "";
}

// ── Gemini synthesis ──────────────────────────────────────────────────────────

async function geminiAnalyze(ticker: string, snap: Record<string, any>, memory = "", debateContext = ""): Promise<string> {
  if (!GEMINI_KEY) return "GEMINI_API_KEY not set.";
  const memorySection = memory
    ? `\n\n## Agent Memory — Context From Prior Scans\nUse this to identify connections to existing themes and avoid re-surfacing ideas already well-covered:\n${memory}\n`
    : "";
  const debateSection = debateContext
    ? `\n\n## Multi-AI Debate — Bull vs Bear Arguments\nVenice (bull advocate, live web search) and DeepSeek (quantitative bear) have debated this stock in two rounds. Use their arguments to sharpen your analysis — weigh which side has stronger evidence and explicitly state where each is right or wrong in your ANALYSIS section.\n\n${debateContext}\n`
    : "";
  const prompt = `You are a quantitative research analyst for the Asymmetry Opportunity Radar.${memorySection}${debateSection}
Mission: find asymmetric upside in LESSER-KNOWN or BEATEN-DOWN stocks that institutional capital has ignored.
Analyze ${ticker} using this live market data:
${JSON.stringify(snap, null, 2)}

Focus on:
- WHY has the market mispriced or ignored this company?
- Is there a transformation, rebrand, or renaissance the market hasn't priced in?
- What would make this a 3-10x from current price?

Apply the full 7-question framework:
1. Why interesting NOW? What changed in 6-18 months the market hasn't repriced?
2. What specific catalyst will reprice the stock? (name the event)
3. What is the market MISSING? (name the specific mispricing)
4. Downside: bear case price in 18 months + what breaks the thesis?
5. Upside: base case + bull case price targets with assumptions
6. Evidence: primary sources supporting the thesis
7. Invalidation: exact conditions that would make you wrong

Also provide:
- BUSINESS_MODEL: 2-3 sentences on how they make money
- REVENUE_STREAMS: comma-separated list of 3-4 revenue sources
- MOAT: 1-2 sentences on competitive edge
- COMPETITORS: comma-separated list of top 3 rivals
- CATALYSTS: pipe-separated as "event1|timing1|event2|timing2|event3|timing3"
- FLOOR_PRICE: bear case price as a plain number only
- TARGET_PRICE: base case price as a plain number only
- BULL_PRICE: bull case price as a plain number only
- INVALIDATION: one sentence — exact condition that breaks the thesis
- BULL_CASE: 2-3 plain English sentences explaining why this stock could go up a lot — no finance jargon, write for someone who has never invested before, explain what has to go right
- BEAR_CASE: 2-3 plain English sentences explaining the main risks — no finance jargon, write for someone who has never invested before, explain what could go wrong and why the stock might lose value
- COMPETITOR_VS: for each competitor write "Name::2-sentence comparison of how ${ticker} stacks up against them" — separate competitors with three pipes like "|||" — do NOT use the "|" character inside any comparison text

Score 1-10: Asymmetry, Conviction, Catalyst Strength, Management Quality.
Tier 1=10x+ exceptional, 2=3-10x solid, 3=watchlist only.

Respond in EXACTLY this format (one field per line):
TIER: [1/2/3]
THESIS: [one sentence]
ASYMMETRY: [X/10]
CONVICTION: [X/10]
CATALYST: [X/10]
MANAGEMENT: [X/10]
OVERALL: [0-100]
BUSINESS_MODEL: [text]
REVENUE_STREAMS: [stream1, stream2, stream3]
MOAT: [text]
COMPETITORS: [A, B, C]
CATALYSTS: [event1|timing1|event2|timing2|event3|timing3]
FLOOR_PRICE: [number]
TARGET_PRICE: [number]
BULL_PRICE: [number]
INVALIDATION: [text]
BULL_CASE: [plain language text]
BEAR_CASE: [plain language text]
COMPETITOR_VS: [Name1::comparison text|||Name2::comparison text|||Name3::comparison text]
ANALYSIS:
[7-question analysis]`;
  try {
    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );
    if (!res.ok) return `Gemini error (${res.status}): ${(await res.text()).slice(0, 300)}`;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response.";
  } catch (e) { return `Gemini error: ${String(e)}`; }
}

function parseGemini(text: string) {
  const get = (k: string) => {
    const m = text.match(new RegExp(`^${k}:\\s*(.+)`, "im"));
    return m ? m[1].trim() : null;
  };
  const analysis = text.match(/^ANALYSIS:\s*\n([\s\S]*?)$/im)?.[1]?.trim() ?? "";
  const rawCats  = get("CATALYSTS") ?? "";
  const cats = rawCats.split("|").reduce((acc: any[], v, i, arr) => {
    if (i % 2 === 0 && arr[i + 1]) acc.push({ event: v.trim(), timing: arr[i + 1].trim() });
    return acc;
  }, []);
  const rawCompVs = get("COMPETITOR_VS") ?? "";
  const compVs = rawCompVs.split("|||").map((s: string) => {
    const idx = s.indexOf("::");
    if (idx < 0) return { name: s.trim(), vs: "" };
    return { name: s.slice(0, idx).trim(), vs: s.slice(idx + 2).trim() };
  }).filter((c: any) => c.name && c.vs);
  return {
    tier:            parseInt(get("TIER") ?? "3"),
    thesis:          get("THESIS") ?? "",
    scores: {
      asymmetry:     parseFloat(get("ASYMMETRY")  ?? "0"),
      conviction:    parseFloat(get("CONVICTION") ?? "0"),
      catalyst:      parseFloat(get("CATALYST")   ?? "0"),
      management:    parseFloat(get("MANAGEMENT") ?? "0"),
    },
    overall:         parseFloat(get("OVERALL") ?? "0"),
    business_model:  get("BUSINESS_MODEL") ?? "",
    revenue_streams: (get("REVENUE_STREAMS") ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    moat:            get("MOAT") ?? "",
    competitors:     (get("COMPETITORS") ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    catalysts:       cats,
    floor_price:     parseFloat(get("FLOOR_PRICE")  ?? "0"),
    target_price:    parseFloat(get("TARGET_PRICE") ?? "0"),
    bull_price:      parseFloat(get("BULL_PRICE")   ?? "0"),
    invalidation:    get("INVALIDATION") ?? "",
    bull_case:       get("BULL_CASE") ?? "",
    bear_case:       get("BEAR_CASE") ?? "",
    competitor_vs:   compVs,
    analysis,
  };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function money(v: number | null) {
  if (!v) return "N/A";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}
function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "N/A"; }
function fmt(v: number | null | undefined, sfx = "") { return v != null ? `${v.toFixed(1)}${sfx}` : "N/A"; }
function bar(v: number) { return "█".repeat(Math.round(v)) + "░".repeat(10 - Math.round(v)); }
function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function md(s: string | null | undefined): string {
  if (!s) return "";
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function generateHtml(
  ticker: string, p: ReturnType<typeof parseGemini>,
  snap: Record<string, any>, qScore: number
): string {
  const ts      = new Date().toUTCString();
  const tier    = p.tier;
  const tc      = tier === 1 ? "#ef4444" : tier === 2 ? "#f97316" : "#eab308";
  const tierLbl = tier === 1 ? "TIER 1 — EXCEPTIONAL" : tier === 2 ? "TIER 2 — HIGH CONVICTION" : "TIER 3 — WATCHLIST";
  const scores  = p.scores;
  const price   = snap.price;
  const up      = p.target_price && price ? (((p.target_price - price) / price) * 100).toFixed(0) : "—";
  const dn      = p.floor_price  && price ? (((price - p.floor_price)  / price) * 100).toFixed(0) : "—";
  const bm      = p.bull_price   && price ? `${(p.bull_price / price).toFixed(1)}x` : "—";

  const insClass = snap.insider_signal === "BUY" ? "pos" : snap.insider_signal === "SELL" ? "neg" : "";
  const revClass = (snap.revenue_growth ?? 0) > 0 ? "pos" : "neg";
  const pfhClass = (snap.pct_from_high ?? 0) < 0 ? "neg" : "pos";

  const sRow = (label: string, val: number) =>
    `<div class="srow"><span class="slabel">${label}</span><span class="sbar">${bar(val)}</span><span class="sval">${val}/10</span></div>`;

  const streams = p.revenue_streams.map((rs: string) => `<li>${esc(rs)}</li>`).join("");
  const comps   = p.competitors.map((c: string) => `<span class="ctag">${esc(c)}</span>`).join("");
  const cats    = p.catalysts.map((c: any, i: number) =>
    `<div class="cat-row"><span class="cat-n">${i + 1}</span><div><div class="cat-event">${esc(c.event)}</div><div class="cat-timing">${esc(c.timing)}</div></div></div>`
  ).join("");
  const analysisHtml = md(p.analysis);

  const bullBearHtml = (p.bull_case || p.bear_case) ? [
    `<h2>Bull Case vs Bear Case</h2>`,
    `<div class="bc-grid">`,
    `<div class="bc-box bullcase"><div class="bc-lbl">&#9650; Bull Case &mdash; What Has to Go Right</div><p>${md(p.bull_case)}</p></div>`,
    `<div class="bc-box bearcase"><div class="bc-lbl">&#9660; Bear Case &mdash; What Could Go Wrong</div><p>${md(p.bear_case)}</p></div>`,
    `</div>`,
  ].join("") : "";

  const compVsHtml = p.competitor_vs.length > 0 ? [
    `<h2>Competitor Analysis</h2>`,
    `<div class="comp-grid">`,
    ...p.competitor_vs.map((c: any) =>
      `<div class="comp-card"><div class="comp-name">${esc(c.name)}</div><p>${esc(c.vs)}</p></div>`
    ),
    `</div>`,
  ].join("") : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ticker)} — Asymmetry Radar</title>
<style>
:root{--bg:#0c0c0e;--sf:#141417;--sf2:#1c1c20;--bd:#2a2a30;--tx:#e2e2e8;--mt:#6b6b7a;
  --ac:#00d4aa;--pos:#22c55e;--neg:#ef4444;--warn:#f97316;--tc:${tc};
  --fn:'SF Mono','Fira Code','Cascadia Code','Consolas',monospace}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--fn);background:var(--bg);color:var(--tx);padding:40px 48px;
  max-width:1100px;margin:0 auto;line-height:1.65;font-size:13px}
h1{font-size:30px;font-weight:800;letter-spacing:-1px}
h2{font-size:10px;text-transform:uppercase;letter-spacing:3px;color:var(--ac);
  margin:44px 0 16px;padding-bottom:8px;border-bottom:1px solid var(--bd)}
h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--mt);margin-bottom:10px}
p{color:#b0b0bc;font-size:13px;line-height:1.8}
.pos{color:var(--pos)}.neg{color:var(--neg)}.mt{color:var(--mt)}
.cover{margin-bottom:44px}
.ctop{display:flex;align-items:flex-start;gap:20px;margin-bottom:16px}
.tbadge{background:var(--tc);color:#000;font-weight:800;font-size:10px;
  padding:5px 12px;border-radius:4px;letter-spacing:2px;white-space:nowrap;margin-top:6px}
.tdate{color:var(--mt);font-size:10px;margin-top:6px}
.thesis-block{background:var(--sf);border-left:3px solid var(--tc);
  padding:16px 20px;border-radius:0 8px 8px 0;margin-top:18px}
.thesis-lbl{font-size:9px;text-transform:uppercase;letter-spacing:2px;color:var(--tc);font-weight:700;margin-bottom:6px}
.thesis-tx{font-size:15px;color:var(--tx);font-style:italic;line-height:1.5}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:18px 16px}
.clbl{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--mt);margin-bottom:8px}
.cval{font-size:22px;font-weight:700;line-height:1}
.csub{font-size:10px;color:var(--mt);margin-top:6px}
.biz-grid{display:grid;grid-template-columns:3fr 2fr;gap:20px}
.box{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:20px}
.streams{margin-top:10px;padding-left:0;list-style:none}
.streams li{padding:6px 0;border-bottom:1px solid var(--bd);font-size:12px;color:#b0b0bc}
.streams li:last-child{border-bottom:none}
.streams li::before{content:'▸ ';color:var(--ac)}
.ctags{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.ctag{background:var(--sf2);border:1px solid var(--bd);font-size:11px;padding:4px 10px;border-radius:4px;color:var(--mt)}
.score-wrap{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:24px;
  display:grid;grid-template-columns:1fr 110px;gap:20px;align-items:center}
.srow{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.srow:last-child{margin-bottom:0}
.slabel{width:145px;font-size:11px;color:var(--mt)}
.sbar{color:var(--ac);letter-spacing:1px;font-size:14px}
.sval{font-size:12px;font-weight:700;width:36px;text-align:right}
.overall{text-align:right}
.onum{font-size:54px;font-weight:800;color:var(--ac);line-height:1}
.odenom{font-size:11px;color:var(--mt)}
.ag{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.ac{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:20px;text-align:center}
.ac.bear{border-color:var(--neg);background:#160808}
.ac.base{border-color:var(--ac);background:#081612}
.ac.bull{border-color:var(--pos);background:#081208}
.albl{font-size:9px;text-transform:uppercase;letter-spacing:2px;color:var(--mt);margin-bottom:10px}
.aprice{font-size:26px;font-weight:800}
.achg{font-size:12px;margin-top:6px;font-weight:600}
.bear .aprice,.bear .achg{color:var(--neg)}
.base .aprice,.base .achg{color:var(--ac)}
.bull .aprice,.bull .achg{color:var(--pos)}
.vbox{background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:18px 20px;margin-top:14px}
.vlbl{font-size:9px;text-transform:uppercase;letter-spacing:2px;color:var(--ac);font-weight:700;margin-bottom:8px}
.bc-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.bc-box{border:1px solid;border-radius:8px;padding:20px}
.bc-box.bullcase{border-color:var(--pos);background:#081208}
.bc-box.bearcase{border-color:var(--neg);background:#160808}
.bc-lbl{font-size:9px;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:10px}
.bc-box.bullcase .bc-lbl{color:var(--pos)}
.bc-box.bearcase .bc-lbl{color:var(--neg)}
.cat-row{display:flex;gap:16px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--bd)}
.cat-row:last-child{border-bottom:none}
.cat-n{background:var(--ac);color:#000;font-size:9px;font-weight:800;
  padding:3px 8px;border-radius:10px;white-space:nowrap;margin-top:2px}
.cat-event{font-size:13px;font-weight:600;margin-bottom:2px}
.cat-timing{font-size:11px;color:var(--mt)}
.comp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.comp-card{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:18px}
.comp-name{font-size:12px;font-weight:700;color:var(--ac);margin-bottom:8px}
.abody{background:var(--sf);border:1px solid var(--bd);border-radius:8px;
  padding:24px;font-size:12px;color:#b0b0bc;line-height:2}
.footer{margin-top:56px;padding-top:16px;border-top:1px solid var(--bd);
  font-size:10px;color:var(--mt);display:flex;justify-content:space-between}
@media print{
  body{background:#fff;color:#111;padding:20px}
  :root{--bg:#fff;--sf:#f7f7f7;--sf2:#efefef;--bd:#ddd;--tx:#111;--mt:#555;
    --ac:#007a62;--pos:#166534;--neg:#991b1b;--tc:${tc}}
  .cover{page-break-after:always}
  .ac,.card,.box,.score-wrap,.bc-box,.comp-card{break-inside:avoid}
}
</style>
</head>
<body>

<div class="cover">
  <div class="ctop">
    <div><h1>$${esc(ticker)}</h1><div class="mt" style="font-size:14px;margin-top:4px">${esc(ticker)}</div></div>
    <div><div class="tbadge">${tierLbl}</div><div class="tdate">Asymmetry Radar · ${ts}</div></div>
  </div>
  <div class="thesis-block">
    <div class="thesis-lbl">Investment Thesis</div>
    <div class="thesis-tx">${esc(p.thesis)}</div>
  </div>
</div>

<h2>Key Metrics</h2>
<div class="cards">
  <div class="card"><div class="clbl">Current Price</div><div class="cval">$${price ?? "—"}</div><div class="csub">52W: $${snap.year_low ?? "—"} – $${snap.year_high ?? "—"}</div></div>
  <div class="card"><div class="clbl">From 52W High</div><div class="cval ${pfhClass}">${snap.pct_from_high ?? "—"}%</div><div class="csub">Mkt Cap: ${money(snap.market_cap)}</div></div>
  <div class="card"><div class="clbl">Revenue Growth</div><div class="cval ${revClass}">${pct(snap.revenue_growth)}</div><div class="csub">P/S TTM: ${fmt(snap.ps_ttm, "x")}</div></div>
  <div class="card"><div class="clbl">Gross Margin</div><div class="cval">${pct(snap.gross_margin)}</div><div class="csub">Op Margin: ${pct(snap.operating_margin)}</div></div>
  <div class="card"><div class="clbl">EV / EBITDA</div><div class="cval">${fmt(snap.ev_ebitda, "x")}</div><div class="csub">Quant Score: ${qScore}/100</div></div>
  <div class="card"><div class="clbl">Insider Signal</div><div class="cval ${insClass}">${snap.insider_signal}</div><div class="csub">${snap.insider_buys}B / ${snap.insider_sells}S</div></div>
</div>

<h2>Business Model</h2>
<div class="biz-grid">
  <div class="box">
    <h3>How They Make Money</h3>
    <p>${esc(p.business_model)}</p>
    <ul class="streams">${streams}</ul>
  </div>
  <div>
    <div class="box" style="margin-bottom:14px">
      <h3>Top Competitors</h3>
      <div class="ctags">${comps}</div>
    </div>
    <div class="box">
      <h3>Competitive Moat</h3>
      <p>${esc(p.moat)}</p>
    </div>
  </div>
</div>

<h2>Conviction Scorecard</h2>
<div class="score-wrap">
  <div>
    ${sRow("Asymmetry", scores.asymmetry)}
    ${sRow("Conviction", scores.conviction)}
    ${sRow("Catalyst Strength", scores.catalyst)}
    ${sRow("Management Quality", scores.management)}
  </div>
  <div class="overall"><div class="onum">${p.overall}</div><div class="odenom">/ 100</div></div>
</div>

<h2>Asymmetry Model</h2>
<div class="ag">
  <div class="ac bear"><div class="albl">Bear / Floor</div><div class="aprice">$${p.floor_price || "—"}</div><div class="achg">−${dn}%</div></div>
  <div class="ac base"><div class="albl">Base / Target</div><div class="aprice">$${p.target_price || "—"}</div><div class="achg">+${up}%</div></div>
  <div class="ac bull"><div class="albl">Bull / Ceiling</div><div class="aprice">$${p.bull_price || "—"}</div><div class="achg">${bm} potential</div></div>
</div>
<div class="vbox">
  <div class="vlbl">⚠ Invalidation Trigger</div>
  <p>${esc(p.invalidation)}</p>
</div>

${bullBearHtml}

<h2>Catalysts — Next 12 Months</h2>
<div>${cats}</div>

${compVsHtml}

<h2>Full Analysis</h2>
<div class="abody">${analysisHtml}</div>

<div class="footer">
  <span>Asymmetry Opportunity Radar · ${ts}</span>
  <span>Not investment advice. Do your own research.</span>
</div>
</body></html>`;
}

// ── Markdown report (Obsidian) ────────────────────────────────────────────────

function generateMarkdown(
  ticker: string, p: ReturnType<typeof parseGemini>,
  snap: Record<string, any>, qScore: number
): string {
  const date     = new Date().toISOString().slice(0, 10);
  const tierLbl  = p.tier === 1 ? "Tier 1 — Exceptional" : p.tier === 2 ? "Tier 2 — High Conviction" : "Tier 3 — Watchlist";
  const up       = p.target_price && snap.price ? (((p.target_price - snap.price) / snap.price) * 100).toFixed(0) : "—";
  const dn       = p.floor_price  && snap.price ? (((snap.price - p.floor_price)  / snap.price) * 100).toFixed(0) : "—";
  const bm       = p.bull_price   && snap.price ? `${(p.bull_price / snap.price).toFixed(1)}x` : "—";
  const s        = p.scores;

  const catsSection = p.catalysts.map((c, i) => `${i + 1}. **${c.event}** — ${c.timing}`).join("\n");
  const compVsSection = p.competitor_vs.length > 0
    ? p.competitor_vs.map(c => `### ${c.name}\n${c.vs}`).join("\n\n")
    : "*No comparison data.*";

  const tags = ["asymmetry-radar", `tier-${p.tier}`];
  if (snap.insider_signal === "BUY") tags.push("insider-buy");
  if ((snap.revenue_growth ?? 0) > 0.3) tags.push("high-growth");
  if ((snap.market_cap ?? 1e12) < 2e9) tags.push("small-cap");

  return `---
ticker: ${ticker}
tier: ${p.tier}
overall_score: ${p.overall}
quant_score: ${qScore}
asymmetry: ${s.asymmetry}
conviction: ${s.conviction}
catalyst: ${s.catalyst}
management: ${s.management}
price: ${snap.price ?? ""}
floor_price: ${p.floor_price || ""}
target_price: ${p.target_price || ""}
bull_price: ${p.bull_price || ""}
revenue_growth: ${snap.revenue_growth ?? ""}
gross_margin: ${snap.gross_margin ?? ""}
insider_signal: ${snap.insider_signal}
date: ${date}
status: active
tags: [${tags.join(", ")}]
---

# $${ticker} — ${tierLbl}
> **${p.thesis}**
> *Asymmetry Radar · ${date}*

---

## Asymmetry Model

| | Bear | Base | Bull |
|---|---|---|---|
| **Price** | $${p.floor_price || "—"} | $${p.target_price || "—"} | $${p.bull_price || "—"} |
| **Change** | −${dn}% | +${up}% | ${bm} |

## Conviction Scores

| Dimension | Score |
|---|---|
| Asymmetry | ${s.asymmetry}/10 |
| Conviction | ${s.conviction}/10 |
| Catalyst Strength | ${s.catalyst}/10 |
| Management Quality | ${s.management}/10 |
| **Overall** | **${p.overall}/100** |

## Key Metrics

| Metric | Value |
|---|---|
| Price | $${snap.price ?? "N/A"} |
| Market Cap | ${snap.market_cap ? `$${(snap.market_cap / 1e6).toFixed(0)}M` : "N/A"} |
| Revenue Growth YoY | ${snap.revenue_growth != null ? `${(snap.revenue_growth * 100).toFixed(1)}%` : "N/A"} |
| Gross Margin | ${snap.gross_margin != null ? `${(snap.gross_margin * 100).toFixed(1)}%` : "N/A"} |
| P/S TTM | ${snap.ps_ttm != null ? `${snap.ps_ttm.toFixed(1)}x` : "N/A"} |
| Insider Signal | ${snap.insider_signal} (${snap.insider_buys}B / ${snap.insider_sells}S) |
| Quant Score | ${qScore}/100 |

---

## Business Model

${p.business_model}

**Revenue Streams:** ${p.revenue_streams.join(" · ")}

**Competitors:** ${p.competitors.map(c => `[[${c}]]`).join(" · ")}

**Moat:** ${p.moat}

---

## Bull Case ▲ — What Has to Go Right

${p.bull_case}

## Bear Case ▼ — What Could Go Wrong

${p.bear_case}

---

## Catalysts — Next 12 Months

${catsSection || "*No catalysts identified.*"}

---

## Competitor Analysis

${compVsSection}

---

## ⚠️ Invalidation Trigger

> ${p.invalidation}

---

## Full Analysis

${p.analysis}

---

*Asymmetry Opportunity Radar · ${date} · Not investment advice.*
`;
}

// ── Agent memory ──────────────────────────────────────────────────────────────

async function readMemory(): Promise<string> {
  const { data } = await supabase.from("radar_memory")
    .select("content").eq("key", "agent_context").single();
  return data?.content ?? "";
}

async function updateMemory(ticker: string, p: ReturnType<typeof parseGemini>, snap: Record<string, any>) {
  const current = await readMemory();
  const date    = new Date().toISOString().slice(0, 10);
  const entry   = `- **$${ticker}** (Tier ${p.tier}, ${p.overall}/100) — ${p.thesis} [${date}]`;

  let updated = current;
  if (p.tier <= 2) {
    if (updated.includes("## Active Themes")) {
      updated = updated.replace(
        /## Active Themes\n(\*.*?\*|.*?)(\n\n|$)/s,
        `## Active Themes\n${entry}\n$2`
      );
    }
  }

  const outcomeNote = `- $${ticker}: Tier ${p.tier} | Score ${p.overall} | Target $${p.target_price || "—"} | Invalidation: ${p.invalidation} [scanned ${date}]`;
  if (updated.includes("## Recent Outcomes")) {
    const lines = updated.split("\n");
    const idx   = lines.findIndex(l => l.startsWith("## Recent Outcomes"));
    if (idx >= 0) {
      lines.splice(idx + 1, 0, outcomeNote);
      updated = lines.join("\n");
    }
  }

  await supabase.from("radar_memory")
    .upsert(
      { key: "agent_context", content: updated, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
}

// ── GitHub vault push ─────────────────────────────────────────────────────────

async function pushToGitHub(path: string, content: string, message: string): Promise<{ ok: boolean; status: number; body: string }> {
  const token  = Deno.env.get("GITHUB_TOKEN");
  if (!token) return { ok: false, status: 0, body: "GITHUB_TOKEN not set" };
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

  const payload: Record<string, any> = {
    message, branch,
    content: btoa(unescape(encodeURIComponent(content))),
  };
  if (sha) payload.sha = sha;

  const res  = await fetch(apiUrl, { method: "PUT", headers: hdrs, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) console.error(`[github] PUT ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

// ── Notification ──────────────────────────────────────────────────────────────

async function notify(title: string, body: string, priority = 4) {
  await fetch("https://ntfy.sh/", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: NTFY_TOPIC, title, message: body, priority, tags: ["chart_with_upwards_trend"] }),
  });
}

function formatAlert(ticker: string, p: ReturnType<typeof parseGemini>, snap: Record<string, any>): string {
  const s  = p.scores;
  const up = p.target_price && snap.price ? (((p.target_price - snap.price) / snap.price) * 100).toFixed(0) : "—";
  const dn = p.floor_price  && snap.price ? (((snap.price - p.floor_price)  / snap.price) * 100).toFixed(0) : "—";
  return [
    `${p.tier === 1 ? "🔺" : "🔷"} TIER ${p.tier} — $${ticker}`,
    "━".repeat(30),
    "📌 THESIS", p.thesis, "",
    "💰 LIVE DATA",
    `  Price:        $${snap.price ?? "—"}`,
    `  Market Cap:   ${money(snap.market_cap)}`,
    `  Rev Growth:   ${pct(snap.revenue_growth)}`,
    `  Gross Margin: ${pct(snap.gross_margin)}`,
    `  P/S TTM:      ${fmt(snap.ps_ttm, "x")}`,
    `  Insider:      ${snap.insider_signal} (${snap.insider_buys}B/${snap.insider_sells}S)`,
    `  52W High:     $${snap.year_high ?? "—"} (${snap.pct_from_high ?? "—"}%)`, "",
    "⚡ ASYMMETRY",
    `  Floor:  $${p.floor_price || "—"}  (−${dn}%)`,
    `  Target: $${p.target_price || "—"}  (+${up}%)`,
    `  Bull:   $${p.bull_price || "—"}`, "",
    "📊 CONVICTION SCORES",
    `  Asymmetry   ${bar(s.asymmetry)}  ${s.asymmetry}/10`,
    `  Conviction  ${bar(s.conviction)}  ${s.conviction}/10`,
    `  Catalyst    ${bar(s.catalyst)}  ${s.catalyst}/10`,
    `  Management  ${bar(s.management)}  ${s.management}/10`,
    "  " + "─".repeat(25),
    `  OVERALL     ${p.overall}/100`, "",
    "⚠️ INVALIDATION", p.invalidation, "",
    "💰 POSITION SIZE",
    `  Score ${p.overall}/100 → ${positionMultiplier(p.overall)}x = $${positionDollars(p.overall).toLocaleString()}`,
    `  Deploy: $${DCA_BASE.toLocaleString()} base${positionMultiplier(p.overall) > 1 ? ` + $${(positionDollars(p.overall) - DCA_BASE).toLocaleString()} from dry powder` : " only (cautious entry)"}`,
  ].join("\n");
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const body      = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const testMode  = body.test === true;
  const diagMode  = body.diag === true;
  const runStart  = new Date();
  let tickersScanned = 0, oppsFound = 0;
  const errors: string[] = [];

  const auth   = await getYFAuth();
  const memory = await readMemory();

  if (body.github_test === true) {
    const token  = Deno.env.get("GITHUB_TOKEN");
    const repo   = Deno.env.get("GITHUB_REPO")   ?? "maple-maker/aegis-intel-vault";
    const branch = Deno.env.get("GITHUB_BRANCH") ?? "main";
    const result = await pushToGitHub(
      "vault/_test/radar-ping.md",
      `# Radar Ping\nTest push from asymmetry-radar at ${new Date().toISOString()}\n`,
      `test: radar → vault ping [${new Date().toISOString().slice(0, 10)}]`
    );
    return new Response(JSON.stringify({ token_set: !!token, repo, branch, ...result }, null, 2),
      { headers: { "Content-Type": "application/json" } });
  }

  if (diagMode) {
    const ticker = body.ticker ?? "CODA";
    const res: Record<string, any> = { gemini_key_set: !!GEMINI_KEY, venice_key_set: !!VENICE_KEY, deepseek_key_set: !!DEEPSEEK_KEY, yf_auth_ok: !!auth };
    try { const sn = await getSnapshot(ticker, auth); res.snapshot = sn; res.yf_ok = true; }
    catch (e) { res.yf_error = String(e); }
    if (GEMINI_KEY) {
      try {
        const r = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ generationConfig: { thinkingConfig: { thinkingBudget: 0 } }, contents: [{ parts: [{ text: "Reply: GEMINI_OK" }] }] }) });
        res.gemini_status = r.status; res.gemini_ok = r.ok;
      } catch (e) { res.gemini_error = String(e); }
    }
    return new Response(JSON.stringify(res, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  const { data: runRow } = await supabase.from("radar_runs")
    .insert({ started_at: runStart.toISOString() }).select("id").single();
  const runId = runRow?.id;

  let tickers: string[];
  if (testMode) {
    tickers = body.tickers ?? ["CODA"];
  } else {
    const { data: wl } = await supabase.from("radar_watchlist").select("ticker");
    tickers = (wl ?? []).map((r: any) => r.ticker);
  }

  for (const ticker of tickers) {
    try {
      tickersScanned++;
      const snap   = await getSnapshot(ticker, auth);
      if (!snap.price) { errors.push(`${ticker}: price null`); continue; }
      const qScore = quantScore(snap);
      if (!testMode && qScore < 55) continue;

      // Phase 1: quick Gemini scan to filter before spending debate tokens
      // testMode bypasses the gate so the full pipeline can be exercised manually
      const phase1Text = await geminiAnalyze(ticker, snap, memory);
      const phase1     = parseGemini(phase1Text);
      if (!testMode && (phase1.overall < 75 || phase1.tier > 2)) continue;

      // Phase 2: multi-model debate for qualifying tickers only
      // Venice (bull) and DeepSeek (bear) debate in 2 rounds; Gemini synthesizes.
      const debateCtx  = await runDebate(ticker, snap);
      const geminiText = debateCtx
        ? await geminiAnalyze(ticker, snap, memory, debateCtx)
        : phase1Text;
      const parsed = debateCtx ? parseGemini(geminiText) : phase1;

      // Quality gate re-check — debate may sharpen scores up or down
      // testMode also bypasses here so the full result is always saved for inspection
      if (!testMode && (parsed.overall < 75 || parsed.tier > 2)) continue;
      oppsFound++;

      const html     = generateHtml(ticker, parsed, snap, qScore);
      const mdReport = generateMarkdown(ticker, parsed, snap, qScore);
      const scanDate = new Date().toISOString().slice(0, 10);

      await updateMemory(ticker, parsed, snap);

      // Push markdown to GitHub → Obsidian vault auto-pulls
      const mdPath = `vault/opportunities/${ticker}_${scanDate}.md`;
      await pushToGitHub(
        mdPath, mdReport,
        `scan: $${ticker} Tier ${parsed.tier} ${parsed.overall}/100 [${scanDate}]`
      );
      const updatedMemory = await readMemory();
      await pushToGitHub(
        "vault/_memory/agent_context.md", updatedMemory,
        `memory: update after $${ticker} scan [${scanDate}]`
      );

      const { data: oppRow } = await supabase.from("radar_opportunities").insert({
        ticker, tier: parsed.tier, overall_score: parsed.overall,
        quant_score: qScore, thesis: parsed.thesis,
        gemini_analysis: geminiText, data_snapshot: { ...snap, debate_transcript: debateCtx || null },
        report_html: html, report_md: mdReport, notified: true,
      }).select("id").single();

      const rowId = oppRow?.id;
      const reportUrl = rowId ? `${REPORT_BASE}&id=${rowId}` : null;

      if (rowId && reportUrl) {
        await supabase.from("radar_opportunities")
          .update({ report_url: reportUrl }).eq("id", rowId);
      }

      const alertMsg = formatAlert(ticker, parsed, snap)
        + (reportUrl ? `\n\n📄 Full Report:\n${reportUrl}` : "");

      await notify(
        `${parsed.tier === 1 ? "🔺 TIER 1 — Exceptional" : "🔷 TIER 2 — High Conviction"}: $${ticker}`,
        alertMsg, parsed.tier === 1 ? 5 : 4
      );
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) { errors.push(`${ticker}: ${String(e)}`); }
  }

  await supabase.from("radar_runs").update({
    finished_at: new Date().toISOString(),
    tickers_scanned: tickersScanned, opportunities_found: oppsFound,
    error_log: errors.length ? errors.join("\n") : null,
  }).eq("id", runId);

  return new Response(
    JSON.stringify({ ok: true, scanned: tickersScanned, opportunities: oppsFound, errors }),
    { headers: { "Content-Type": "application/json" } }
  );
});

// Deployed via Supabase MCP — see deploy history in AEGIS project
// Function: radar-scan | Project: jmtkygwvmrolfvwueggs | Version: 11
// Schedule: every 6 hours via pg_cron (0 0,6,12,18 * * *)
// Data source: Yahoo Finance (crumb auth) — covers all tickers, no API key needed
//
// To redeploy: use Supabase MCP deploy_edge_function tool
// To view logs: Supabase dashboard → AEGIS → Edge Functions → radar-scan → Logs
// To add tickers: INSERT INTO radar_watchlist (ticker, notes) VALUES ('TICK', 'reason');
// To view opportunities: SELECT * FROM radar_opportunities ORDER BY created_at DESC;
// Diagnostic: POST {"diag":true} — tests YF auth + Gemini key + returns live snapshot
// Test mode:  POST {"test":true,"tickers":["RKLB"]} — runs single ticker, skips quant threshold

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_KEY   = Deno.env.get("GEMINI_API_KEY");
const NTFY_TOPIC   = "asymmetry-radar";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta";

const YF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface YFAuth { cookie: string; crumb: string; }

async function getYFAuth(): Promise<YFAuth | null> {
  try {
    const r1 = await fetch("https://fc.yahoo.com", {
      redirect: "follow",
      headers: { "User-Agent": YF_UA, "Accept": "text/html,*/*" },
    });
    const raw = r1.headers.get("set-cookie") ?? "";
    const cookie = raw.split(";")[0];
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

async function getSnapshot(ticker: string, auth: YFAuth | null) {
  const baseHeaders: Record<string, string> = {
    "User-Agent": YF_UA,
    "Accept": "application/json, */*",
    "Referer": "https://finance.yahoo.com/",
    ...(auth ? { "Cookie": auth.cookie } : {}),
  };

  const chartRes = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`,
    { headers: baseHeaders }
  );
  if (!chartRes.ok) throw new Error(`YF chart ${chartRes.status} for ${ticker}`);
  const chart = await chartRes.json();
  const meta  = chart?.chart?.result?.[0]?.meta ?? {};

  const price    = meta.regularMarketPrice as number | null;
  const yearHigh = meta.fiftyTwoWeekHigh   as number | null;
  const yearLow  = meta.fiftyTwoWeekLow    as number | null;
  const mcap     = meta.marketCap          as number | null;

  let sd: any = {}, fd: any = {}, ks: any = {}, ins: any[] = [];
  if (auth) {
    try {
      const summaryUrl =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}` +
        `?modules=summaryDetail,financialData,defaultKeyStatistics,insiderTransactions` +
        `&crumb=${encodeURIComponent(auth.crumb)}`;
      const sr = await fetch(summaryUrl, { headers: baseHeaders });
      if (sr.ok) {
        const sdata = await sr.json();
        const qsr   = sdata?.quoteSummary?.result?.[0] ?? {};
        sd  = qsr.summaryDetail        ?? {};
        fd  = qsr.financialData        ?? {};
        ks  = qsr.defaultKeyStatistics ?? {};
        ins = qsr.insiderTransactions?.transactions ?? [];
      }
    } catch { /* continue with chart-only data */ }
  }

  const buys  = ins.filter((t: any) => (t.transactionText ?? "").toLowerCase().includes("purchase")).length;
  const sells = ins.filter((t: any) => (t.transactionText ?? "").toLowerCase().includes("sale")).length;

  return {
    ticker,
    price,
    market_cap:       mcap ?? sd.marketCap?.raw ?? null,
    pe:               sd.trailingPE?.raw ?? null,
    year_high:        yearHigh,
    year_low:         yearLow,
    pct_from_high:    yearHigh && price ? +((price - yearHigh) / yearHigh * 100).toFixed(1) : null,
    ps_ttm:           ks.priceToSalesTrailingTwelveMonths?.raw ?? null,
    p_fcf:            null,
    ev_ebitda:        ks.enterpriseToEbitda?.raw ?? null,
    gross_margin:     fd.grossMargins?.raw ?? null,
    operating_margin: fd.operatingMargins?.raw ?? null,
    revenue_growth:   fd.revenueGrowth?.raw ?? null,
    earnings_growth:  fd.earningsGrowth?.raw ?? null,
    insider_buys:     buys,
    insider_sells:    sells,
    insider_signal:   buys > sells ? "BUY" : sells > buys ? "SELL" : "NEUTRAL",
  };
}

function quantScore(snap: Record<string, any>): number {
  let s = 0;
  const gr = snap.revenue_growth ?? 0;
  if (gr > 0.5) s += 25; else if (gr > 0.3) s += 20; else if (gr > 0.15) s += 12; else if (gr > 0) s += 5;
  const ps = snap.ps_ttm ?? 999;
  if (ps < 2) s += 20; else if (ps < 5) s += 15; else if (ps < 10) s += 8; else if (ps < 20) s += 3;
  const gm = snap.gross_margin ?? 0;
  if (gm > 0.7) s += 15; else if (gm > 0.5) s += 10; else if (gm > 0.3) s += 5;
  if (snap.insider_signal === "BUY") s += 20;
  if (snap.insider_signal === "SELL") s -= 10;
  const ph = snap.pct_from_high ?? -100;
  if (ph > -10) s += 5; else if (ph > -25) s += 15; else if (ph > -40) s += 8;
  const mc = snap.market_cap ?? 0;
  if (mc < 500_000_000) s += 5; else if (mc < 2_000_000_000) s += 2;
  return Math.max(0, Math.min(100, s));
}

async function geminiAnalyze(ticker: string, snap: Record<string, any>): Promise<string> {
  if (!GEMINI_KEY) return "GEMINI_API_KEY not set.";
  const prompt = `You are a quantitative research analyst for the Asymmetry Opportunity Radar.
Analyze ${ticker} using this live market data:
${JSON.stringify(snap, null, 2)}

Apply the full 7-question framework:
1. Why interesting NOW? (6-18 month change market hasn't repriced)
2. What specific catalyst reprices the stock?
3. What is the market missing?
4. Downside: bear case in 18 months?
5. Upside: base + bull case price targets?
6. Evidence supporting the thesis?
7. What invalidates the thesis?

Score 1-10: Asymmetry, Conviction, Catalyst Strength, Management Quality.
Tier 1=10x+ exceptional, 2=3-10x solid, 3=watchlist.

Respond in EXACTLY this format:
TIER: [1/2/3]
THESIS: [one sentence]
ASYMMETRY: [X/10]
CONVICTION: [X/10]
CATALYST: [X/10]
MANAGEMENT: [X/10]
OVERALL: [0-100]
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
  const get = (k: string) => { const m = text.match(new RegExp(`^${k}:\\s*(.+)`, "im")); return m ? m[1].trim() : null; };
  return {
    tier:    parseInt(get("TIER") ?? "3"),
    thesis:  get("THESIS") ?? "",
    scores: {
      asymmetry:  parseFloat(get("ASYMMETRY")  ?? "0"),
      conviction: parseFloat(get("CONVICTION") ?? "0"),
      catalyst:   parseFloat(get("CATALYST")   ?? "0"),
      management: parseFloat(get("MANAGEMENT") ?? "0"),
    },
    overall: parseFloat(get("OVERALL") ?? "0"),
  };
}

async function notify(title: string, body: string, priority = 4) {
  await fetch("https://ntfy.sh/", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: NTFY_TOPIC, title, message: body, priority, tags: ["chart_with_upwards_trend"] }),
  });
}

function bar(v: number) { return "█".repeat(Math.round(v)) + "░".repeat(10 - Math.round(v)); }
function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "N/A"; }
function fmt(v: number | null | undefined, suffix = "") { return v != null ? `${v.toFixed(1)}${suffix}` : "N/A"; }

function formatAlert(ticker: string, p: ReturnType<typeof parseGemini>, snap: Record<string, any>): string {
  const s = p.scores;
  return [
    `${p.tier === 1 ? "🔺" : "🔷"} TIER ${p.tier} — $${ticker}`,
    "━".repeat(30),
    "📌 THESIS", p.thesis, "",
    "💰 LIVE DATA",
    `  Price:         $${snap.price ?? "—"}`,
    `  Market Cap:    $${snap.market_cap ? (snap.market_cap / 1e6).toFixed(0) + "M" : "—"}`,
    `  Rev Growth:    ${pct(snap.revenue_growth)}`,
    `  Gross Margin:  ${pct(snap.gross_margin)}`,
    `  P/S TTM:       ${fmt(snap.ps_ttm, "x")}`,
    `  EV/EBITDA:     ${fmt(snap.ev_ebitda, "x")}`,
    `  Insider:       ${snap.insider_signal} (${snap.insider_buys}B/${snap.insider_sells}S)`,
    `  52W High:      $${snap.year_high ?? "—"} (${snap.pct_from_high ?? "—"}%)`,
    "",
    "📊 CONVICTION SCORES  [Gemini 2.5 Flash]",
    `  Asymmetry   ${bar(s.asymmetry)}  ${s.asymmetry}/10`,
    `  Conviction  ${bar(s.conviction)}  ${s.conviction}/10`,
    `  Catalyst    ${bar(s.catalyst)}  ${s.catalyst}/10`,
    `  Management  ${bar(s.management)}  ${s.management}/10`,
    "  " + "─".repeat(25),
    `  OVERALL     ${p.overall}/100`,
    "",
    "→ Full analysis logged to Asymmetry radar.",
  ].join("\n");
}

Deno.serve(async (req: Request) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const testMode = body.test === true;
  const diagMode = body.diag === true;
  const runStart = new Date();
  let tickersScanned = 0, oppsFound = 0;
  const errors: string[] = [];

  const auth = await getYFAuth();

  if (diagMode) {
    const ticker = body.ticker ?? "RKLB";
    const results: Record<string, any> = {
      gemini_key_set: !!GEMINI_KEY,
      yf_auth_ok: !!auth,
      yf_crumb_preview: auth ? auth.crumb.slice(0, 10) + "..." : null,
    };
    try {
      const snap = await getSnapshot(ticker, auth);
      results.snapshot = snap;
      results.yf_ok = true;
    } catch (e) { results.yf_error = String(e); }
    if (GEMINI_KEY) {
      try {
        const res = await fetch(
          `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
              contents: [{ parts: [{ text: "Reply with just: GEMINI_OK" }] }]
            })
          }
        );
        results.gemini_status = res.status;
        results.gemini_ok = res.ok;
      } catch (e) { results.gemini_error = String(e); }
    }
    return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  const { data: runRow } = await supabase.from("radar_runs")
    .insert({ started_at: runStart.toISOString() }).select("id").single();
  const runId = runRow?.id;

  let tickers: string[];
  if (testMode) {
    tickers = body.tickers ?? ["RKLB"];
  } else {
    const { data: wl } = await supabase.from("radar_watchlist").select("ticker");
    tickers = (wl ?? []).map((r: any) => r.ticker);
  }

  for (const ticker of tickers) {
    try {
      tickersScanned++;
      const snap = await getSnapshot(ticker, auth);
      if (!snap.price) { errors.push(`${ticker}: price null`); continue; }
      const qScore = quantScore(snap);
      if (!testMode && qScore < 55) continue;

      const geminiText = await geminiAnalyze(ticker, snap);
      const parsed     = parseGemini(geminiText);

      const shouldNotify = testMode ||
        parsed.tier === 1 ||
        (parsed.tier === 2 && parsed.scores.catalyst >= 8) ||
        (parsed.tier === 2 && Object.values(parsed.scores).every(v => v >= 7));

      if (!shouldNotify) continue;
      oppsFound++;

      await supabase.from("radar_opportunities").insert({
        ticker, tier: parsed.tier, overall_score: parsed.overall,
        quant_score: qScore, thesis: parsed.thesis,
        gemini_analysis: geminiText, data_snapshot: snap, notified: true,
      });

      await notify(
        `${parsed.tier === 1 ? "🔺 TIER 1 — Exceptional" : "🔷 TIER 2 — High Conviction"}: $${ticker}`,
        formatAlert(ticker, parsed, snap),
        parsed.tier === 1 ? 5 : 4
      );
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) { errors.push(`${ticker}: ${String(e)}`); }
  }

  await supabase.from("radar_runs").update({
    finished_at: new Date().toISOString(),
    tickers_scanned: tickersScanned,
    opportunities_found: oppsFound,
    error_log: errors.length ? errors.join("\n") : null,
  }).eq("id", runId);

  return new Response(
    JSON.stringify({ ok: true, scanned: tickersScanned, opportunities: oppsFound, errors }),
    { headers: { "Content-Type": "application/json" } }
  );
});

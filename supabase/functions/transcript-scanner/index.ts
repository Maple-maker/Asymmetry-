// Function: transcript-scanner | Project: jmtkygwvmrolfvwueggs
// Schedule: every 4 hours via pg_cron (0 */4 * * *)
// Purpose: monitor earnings calls / public speeches from tech giants,
//          extract supply-chain / technology signals, find small-cap beneficiaries,
//          feed them into radar_watchlist and send ntfy notification.
//
// POST {}                      → auto-pick least recently scanned company
// POST {"company":"NVDA"}      → scan specific company
// POST {"diag":true}           → diagnostics

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VENICE_KEY  = Deno.env.get("VENICE_API_KEY");
const GEMINI_KEY  = Deno.env.get("GEMINI_API_KEY");
const NTFY_TOPIC  = "asymmetry-radar";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta";

// Tickers to exclude from beneficiary results (the tech giants themselves + common variants)
const EXCLUDED_TICKERS = new Set([
  "NVDA","AMD","GOOG","GOOGL","META","AAPL","MSFT","AMZN","TSLA","QCOM","INTC",
]);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Venice AI (web-search enabled) ────────────────────────────────────────────

async function callVenice(prompt: string): Promise<string> {
  if (!VENICE_KEY) return "";
  try {
    const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VENICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kimi-k2-5",
        messages: [{ role: "user", content: prompt }],
        venice_parameters: { enable_web_search: "auto" },
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      console.error(`[venice] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return "";
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    console.error(`[venice] error: ${String(e)}`);
    return "";
  }
}

// ── Gemini synthesis ──────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_KEY) return "";
  try {
    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
          contents: [{ parts: [{ text: prompt }] }],
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!res.ok) {
      console.error(`[gemini] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return "";
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } catch (e) {
    console.error(`[gemini] error: ${String(e)}`);
    return "";
  }
}

// ── ntfy notification ─────────────────────────────────────────────────────────

async function notify(title: string, message: string, priority = 3): Promise<void> {
  try {
    await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title,
        message,
        priority,
        tags: ["satellite"],
      }),
    });
  } catch (e) {
    console.error(`[ntfy] error: ${String(e)}`);
  }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

interface Signal {
  type: string;
  what: string;
  quote: string;
  speaker: string;
  beneficiary_type: string;
  urgency: string;
}

interface Beneficiary {
  ticker: string;
  name: string;
  market_cap: string;
  why: string;
  exposure: string;
  catalyst: string;
  confidence: string;
}

function parseSignals(text: string): Signal[] {
  const signals: Signal[] = [];
  const blocks = text.split("---SIGNAL---").slice(1);
  for (const block of blocks) {
    const end = block.indexOf("---END---");
    const content = end >= 0 ? block.slice(0, end) : block;
    const get = (key: string) => {
      const m = content.match(new RegExp(`^${key}:\\s*(.+)`, "im"));
      return m ? m[1].trim() : "";
    };
    const sig: Signal = {
      type:             get("TYPE"),
      what:             get("WHAT"),
      quote:            get("QUOTE").replace(/^"|"$/g, ""),
      speaker:          get("SPEAKER"),
      beneficiary_type: get("BENEFICIARY_TYPE"),
      urgency:          get("URGENCY"),
    };
    if (sig.what) signals.push(sig);
  }
  return signals;
}

function parseBeneficiaries(text: string, _company: string): Beneficiary[] {
  const beneficiaries: Beneficiary[] = [];
  const blocks = text.split("---COMPANY---").slice(1);
  for (const block of blocks) {
    const end = block.indexOf("---END---");
    const content = end >= 0 ? block.slice(0, end) : block;
    const get = (key: string) => {
      const m = content.match(new RegExp(`^${key}:\\s*(.+)`, "im"));
      return m ? m[1].trim() : "";
    };
    const ticker = get("TICKER").toUpperCase().replace(/[$\s]/g, "");
    if (!ticker || EXCLUDED_TICKERS.has(ticker)) continue;
    const b: Beneficiary = {
      ticker,
      name:       get("NAME"),
      market_cap: get("MARKET_CAP"),
      why:        get("WHY"),
      exposure:   get("EXPOSURE"),
      catalyst:   get("CATALYST"),
      confidence: get("CONFIDENCE") || "MEDIUM",
    };
    beneficiaries.push(b);
  }
  return beneficiaries;
}

// ── Signal extraction prompt (Venice call 1) ──────────────────────────────────

function buildSignalPrompt(company: string, ticker: string): string {
  return `You are an investment signal extractor. Your job is to find what ${company} (${ticker}) NEEDS from external suppliers, partners, and smaller companies — NOT what they build themselves.

Search the internet for ${company}'s most recent:
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

IMPORTANT: Only surface signals where the beneficiary is a SMALLER EXTERNAL company — not ${company} itself, not other tech giants.`;
}

// ── Beneficiary search prompt (Venice call 2) ─────────────────────────────────

function buildBeneficiaryPrompt(company: string, signals: Signal[]): string {
  const signalList = signals.map((s, i) =>
    `Signal ${i + 1} [${s.urgency}]: ${s.what}\n  Beneficiary type: ${s.beneficiary_type}\n  Quote: "${s.quote}"`
  ).join("\n\n");

  return `You are a small-cap equity researcher. Based on the following signals from ${company}'s earnings calls and investor presentations, identify publicly traded companies that directly benefit.

SIGNALS FROM ${company.toUpperCase()}:
${signalList}

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

Be specific and non-obvious. Ignore crowded trades. Ignore anything that every analyst already knows. Find the overlooked supplier, the niche component maker, the specialist software company that feeds directly into ${company}'s stated need.`;
}

// ── Gemini synthesis prompt ───────────────────────────────────────────────────

function buildGeminiSynthesisPrompt(
  company: string,
  signals: Signal[],
  beneficiaries: Beneficiary[],
): string {
  const sigs = signals.map(s =>
    `[${s.urgency}] ${s.type}: ${s.what} (${s.beneficiary_type})`
  ).join("\n");

  const bens = beneficiaries.map(b =>
    `${b.ticker} — ${b.name} | Cap: ${b.market_cap} | Confidence: ${b.confidence}\n  ${b.why}\n  Catalyst: ${b.catalyst}`
  ).join("\n\n");

  return `You are the Asymmetry Opportunity Radar synthesis engine. A signal scanner has extracted investment signals from ${company}'s recent earnings calls and investor presentations, and identified potential beneficiary companies.

SIGNALS EXTRACTED (${signals.length} total):
${sigs}

BENEFICIARY COMPANIES IDENTIFIED (${beneficiaries.length} total):
${bens}

Your tasks:
1. RANK the beneficiary companies by investment quality (asymmetry, specificity of exposure, non-obviousness)
2. FLAG any crowded trades — companies where the ${company} supply chain angle is already well-known to Wall Street
3. IDENTIFY the single most non-obvious thesis — the company where the connection to ${company}'s stated need is real but the market hasn't priced it in
4. For each HIGH confidence beneficiary, verify: does this company meet the minimum radar criteria?
   - Potential 3x+ return from current price within 18 months?
   - Clear catalyst — a specific, identifiable event?
   - Non-consensus narrative — not crowded?
   - Acceptable downside — not binary on one event?

Output a brief synthesis (300-400 words) covering:
- TOP PICK: [ticker] — [one sentence thesis]
- RANKED LIST: all companies by conviction (HIGH/MEDIUM/LOW)
- CROWDED TRADES: flag any already-discovered plays to avoid
- RADAR ADD: list tickers that should be added to the watchlist immediately, with the ${company} signal that triggered it`;
}

// ── Main scan logic ───────────────────────────────────────────────────────────

async function runScan(ticker: string, company: string): Promise<{
  scanId: number;
  signals: Signal[];
  beneficiaries: Beneficiary[];
  synthesis: string;
  addedToWatchlist: string[];
}> {
  console.log(`[scanner] Starting scan: ${company} (${ticker})`);

  // ── Venice call 1: extract signals ────────────────────────────────────────
  const signalPrompt = buildSignalPrompt(company, ticker);
  const rawSignals   = await callVenice(signalPrompt);
  const signals      = parseSignals(rawSignals);
  console.log(`[scanner] ${ticker}: extracted ${signals.length} signals`);

  // ── Venice call 2: find beneficiaries ─────────────────────────────────────
  let beneficiaries: Beneficiary[] = [];
  let rawBeneficiaries = "";
  if (signals.length > 0) {
    const benPrompt    = buildBeneficiaryPrompt(company, signals);
    rawBeneficiaries   = await callVenice(benPrompt);
    beneficiaries      = parseBeneficiaries(rawBeneficiaries, company);
    console.log(`[scanner] ${ticker}: found ${beneficiaries.length} beneficiaries`);
  }

  // ── Gemini synthesis ──────────────────────────────────────────────────────
  let synthesis = "";
  if (beneficiaries.length > 0) {
    const synthPrompt = buildGeminiSynthesisPrompt(company, signals, beneficiaries);
    synthesis         = await callGemini(synthPrompt);
    console.log(`[scanner] ${ticker}: Gemini synthesis complete (${synthesis.length} chars)`);
  }

  // ── Save scan record to DB ────────────────────────────────────────────────
  const { data: scanRow, error: scanErr } = await supabase
    .from("tech_signal_scans")
    .insert({
      company: ticker,
      event_type: "auto",
      raw_extraction: [rawSignals, rawBeneficiaries].filter(Boolean).join("\n\n---BENEFICIARIES---\n\n"),
      signals_json: signals as unknown as Record<string, unknown>[],
      opportunities_found: beneficiaries.length,
    })
    .select("id")
    .single();

  if (scanErr) console.error(`[scanner] DB scan insert error: ${scanErr.message}`);
  const scanId: number = scanRow?.id ?? 0;

  // ── Save individual opportunities ─────────────────────────────────────────
  const addedToWatchlist: string[] = [];

  for (const ben of beneficiaries) {
    // Match beneficiary to the most relevant signal
    const matchedSignal = signals.find(s =>
      s.beneficiary_type.toLowerCase().includes(ben.name.toLowerCase().split(" ")[0]) ||
      ben.why.toLowerCase().includes(s.what.toLowerCase().split(" ").slice(0, 3).join(" "))
    ) ?? signals[0];

    const { error: oppErr } = await supabase
      .from("signal_opportunities")
      .upsert({
        scan_id: scanId || null,
        source_company: ticker,
        signal_theme: matchedSignal?.what ?? "General supply chain signal",
        signal_quote: matchedSignal?.quote ?? "",
        beneficiary_ticker: ben.ticker,
        beneficiary_name: ben.name,
        thesis: ben.why,
        market_cap_est: ben.market_cap,
        revenue_exposure: ben.exposure,
        catalyst: ben.catalyst,
        confidence: ben.confidence,
        added_to_watchlist: false,
      }, { onConflict: "beneficiary_ticker,scan_id" });

    if (oppErr) console.error(`[scanner] opp insert ${ben.ticker}: ${oppErr.message}`);

    // ── Auto-add HIGH confidence to radar_watchlist ────────────────────────
    if (ben.confidence === "HIGH") {
      const notes = `[Tech Giant Signal] ${company} (${ticker}) → ${matchedSignal?.what ?? "supply chain signal"} | ${ben.why.slice(0, 200)}`;
      const { error: wlErr } = await supabase
        .from("radar_watchlist")
        .upsert({ ticker: ben.ticker, notes }, { onConflict: "ticker" });

      if (wlErr) {
        console.error(`[scanner] watchlist upsert ${ben.ticker}: ${wlErr.message}`);
      } else {
        addedToWatchlist.push(ben.ticker);
        // Mark as added in signal_opportunities
        await supabase
          .from("signal_opportunities")
          .update({ added_to_watchlist: true })
          .eq("beneficiary_ticker", ben.ticker)
          .eq("scan_id", scanId);
      }
    }
  }

  // ── Update last_scanned on tech_giant_watchlist ───────────────────────────
  await supabase
    .from("tech_giant_watchlist")
    .update({ last_scanned: new Date().toISOString() })
    .eq("ticker", ticker);

  return { scanId, signals, beneficiaries, synthesis, addedToWatchlist };
}

// ── Format ntfy notification ──────────────────────────────────────────────────

function formatNotification(
  company: string,
  ticker: string,
  signals: Signal[],
  beneficiaries: Beneficiary[],
  addedToWatchlist: string[],
  synthesis: string,
): { title: string; message: string } {
  const highConf  = beneficiaries.filter(b => b.confidence === "HIGH");
  const medConf   = beneficiaries.filter(b => b.confidence === "MEDIUM");
  const highSigs  = signals.filter(s => s.urgency === "HIGH");

  // Extract top pick from synthesis if present
  const topPickMatch = synthesis.match(/TOP PICK:\s*([A-Z]+)\s*[—-]/);
  const topPick = topPickMatch ? topPickMatch[1] : (highConf[0]?.ticker ?? "");

  const title = `📡 Tech Signal: ${company} → ${beneficiaries.length} plays found`;

  const lines: string[] = [
    `📡 TECH GIANT SIGNAL SCAN — ${company} (${ticker})`,
    "━".repeat(32),
    "",
    `🎯 SIGNALS DETECTED: ${signals.length} (${highSigs.length} HIGH urgency)`,
  ];

  if (highSigs.length > 0) {
    for (const s of highSigs.slice(0, 3)) {
      lines.push(`  • [${s.type}] ${s.what.slice(0, 80)}`);
    }
  }

  lines.push("", `🏢 BENEFICIARY COMPANIES: ${beneficiaries.length} found`);

  if (highConf.length > 0) {
    lines.push(`  HIGH confidence:`);
    for (const b of highConf) {
      lines.push(`    ✅ $${b.ticker} — ${b.name.slice(0, 40)}`);
      lines.push(`       ${b.why.slice(0, 100)}...`);
    }
  }

  if (medConf.length > 0) {
    lines.push(`  MEDIUM confidence:`);
    for (const b of medConf.slice(0, 3)) {
      lines.push(`    🔶 $${b.ticker} — ${b.name.slice(0, 40)}`);
    }
  }

  if (topPick) {
    lines.push("", `⭐ TOP PICK: $${topPick}`);
  }

  if (addedToWatchlist.length > 0) {
    lines.push("", `➕ ADDED TO RADAR WATCHLIST:`);
    for (const t of addedToWatchlist) {
      lines.push(`  • $${t}`);
    }
  } else {
    lines.push("", "ℹ️  No HIGH confidence picks met watchlist criteria.");
  }

  lines.push("", "→ Full radar scan will run on next cycle.");

  return { title, message: lines.join("\n") };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const body     = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const diagMode = body.diag === true;

  // ── Diagnostics ────────────────────────────────────────────────────────────
  if (diagMode) {
    const diag: Record<string, unknown> = {
      venice_key_set: !!VENICE_KEY,
      gemini_key_set: !!GEMINI_KEY,
      timestamp: new Date().toISOString(),
    };

    // Check DB tables
    const { data: watchlist } = await supabase
      .from("tech_giant_watchlist")
      .select("ticker, last_scanned, scan_priority")
      .order("scan_priority", { ascending: false });
    diag.tech_giant_watchlist = watchlist;

    const { count } = await supabase
      .from("tech_signal_scans")
      .select("id", { count: "exact", head: true });
    diag.scan_count = count;

    if (GEMINI_KEY) {
      try {
        const r = await fetch(
          `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
              contents: [{ parts: [{ text: "Reply: GEMINI_OK" }] }],
            }),
          },
        );
        diag.gemini_status = r.status;
        diag.gemini_ok = r.ok;
      } catch (e) { diag.gemini_error = String(e); }
    }

    return new Response(JSON.stringify(diag, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Resolve which company to scan ─────────────────────────────────────────
  let ticker  = (body.company ?? "").toUpperCase().trim();
  let company = "";

  if (ticker) {
    // Specific company requested
    const { data: row } = await supabase
      .from("tech_giant_watchlist")
      .select("name")
      .eq("ticker", ticker)
      .single();
    company = row?.name ?? ticker;
  } else {
    // Auto-pick: least recently scanned active company by priority
    const { data: rows } = await supabase
      .from("tech_giant_watchlist")
      .select("ticker, name")
      .eq("active", true)
      .order("last_scanned", { ascending: true, nullsFirst: true })
      .order("scan_priority", { ascending: false })
      .limit(1);

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "No active companies in tech_giant_watchlist" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    ticker  = rows[0].ticker;
    company = rows[0].name;
  }

  console.log(`[scanner] Scanning: ${company} (${ticker})`);

  // ── Run the scan ──────────────────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof runScan>>;
  try {
    result = await runScan(ticker, company);
  } catch (e) {
    console.error(`[scanner] runScan failed: ${String(e)}`);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const { scanId, signals, beneficiaries, synthesis, addedToWatchlist } = result;

  // ── Send ntfy notification ────────────────────────────────────────────────
  if (beneficiaries.length > 0) {
    const { title, message } = formatNotification(
      company, ticker, signals, beneficiaries, addedToWatchlist, synthesis,
    );
    await notify(title, message, 3);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      company,
      ticker,
      scan_id: scanId,
      signals_found: signals.length,
      beneficiaries_found: beneficiaries.length,
      added_to_watchlist: addedToWatchlist,
      synthesis_length: synthesis.length,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});

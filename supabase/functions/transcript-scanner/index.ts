// Function: transcript-scanner | Project: jmtkygwvmrolfvwueggs
// Schedule: every 4 hours via pg_cron (0 */4 * * *)
// Purpose: monitor earnings calls / public speeches from tech giants,
//          extract supply-chain / technology signals, find small-cap beneficiaries,
//          feed them into radar_watchlist and send ntfy notification.
//
// POST {}                      → auto-pick least recently scanned company
// POST {"company":"NVDA"}      → scan specific company
// POST {"company":"OPENAI"}    → scan private AI lab (different prompt path)
// POST {"diag":true}           → diagnostics

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VENICE_KEY  = Deno.env.get("VENICE_API_KEY");
const GEMINI_KEY  = Deno.env.get("GEMINI_API_KEY");
const NTFY_TOPIC  = "asymmetry-radar";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta";

// Private AI labs — not publicly traded, so:
//   1. Different signal extraction prompt (blogs/interviews/job postings vs earnings calls)
//   2. NOT excluded from beneficiary results (they can never self-refer since they have no ticker)
const PRIVATE_AI_LABS = new Set(["ANTHROPIC", "OPENAI", "XAI"]);

// Tickers to exclude from beneficiary results (the tech giants themselves + common variants).
// Private AI labs are intentionally NOT in this list — they're signal sources, not beneficiaries,
// and their pseudo-tickers (ANTHROPIC, OPENAI, XAI) will never appear in equity research anyway.
const EXCLUDED_TICKERS = new Set([
  "NVDA","AMD","GOOG","GOOGL","META","AAPL","MSFT","AMZN","TSLA","QCOM","INTC",
]);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Venice AI (web-search enabled) ────────────────────────────────────────────

// Last Venice error — stored so diag endpoint can surface it
let lastVeniceError = "";

async function callVenice(prompt: string): Promise<string> {
  if (!VENICE_KEY) { lastVeniceError = "VENICE_API_KEY not set"; return ""; }
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
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 400);
      lastVeniceError = `HTTP ${res.status}: ${errBody}`;
      console.error(`[venice] ${lastVeniceError}`);
      return "";
    }
    lastVeniceError = "";
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    console.log(`[venice] response length: ${content.length} chars`);
    return content;
  } catch (e) {
    lastVeniceError = String(e);
    console.error(`[venice] error: ${lastVeniceError}`);
    return "";
  }
}

// Quick Venice ping — sends a tiny prompt to check connectivity and auth
async function pingVenice(): Promise<{ ok: boolean; status?: number; error?: string; latency_ms: number }> {
  if (!VENICE_KEY) return { ok: false, error: "VENICE_API_KEY not set", latency_ms: 0 };
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VENICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kimi-k2-5",
        messages: [{ role: "user", content: "Reply: OK" }],
        venice_parameters: { enable_web_search: "off" },
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const latency_ms = Date.now() - t0;
    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 300);
      return { ok: false, status: res.status, error: errBody, latency_ms };
    }
    return { ok: true, status: res.status, latency_ms };
  } catch (e) {
    return { ok: false, error: String(e), latency_ms: Date.now() - t0 };
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
  source_url: string;
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
      source_url:       get("SOURCE_URL"),
    };
    if (sig.what) signals.push(sig);
  }
  return signals;
}

// Private AI labs are NOT added to EXCLUDED_TICKERS, so their pseudo-tickers won't
// appear in equity research output and there's no accidental self-reference risk.
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
    // Exclude public tech giants from beneficiary results.
    // Private lab pseudo-tickers (ANTHROPIC/OPENAI/XAI) won't realistically appear
    // in equity research, but even if they did they'd be filtered as non-real tickers
    // by downstream FMP/market-data lookups.
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

// ── Signal extraction prompt — public companies (earnings calls) ──────────────

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
SOURCE_URL: [direct URL to the earnings call transcript, investor day recording, interview, or filing where you found this — be specific]
---END---

Extract 4-8 signals. Prioritize HIGH urgency signals where the need is explicit and the beneficiary type is specific and investable. Skip vague or generic statements.

IMPORTANT: Only surface signals where the beneficiary is a SMALLER EXTERNAL company — not ${company} itself, not other tech giants.`;
}

// ── Signal extraction prompt — private AI labs (blogs/interviews/job postings) ─

function buildPrivateLabSignalPrompt(companyName: string, ticker: string): string {
  // Tailor the source hints and focus areas per lab
  const labHints: Record<string, string> = {
    ANTHROPIC: `- Official research blog: anthropic.com/research (model cards, safety papers, interpretability posts)
- CEO/CTO interviews: Dario Amodei and Chris Olah public talks, podcasts, conference keynotes
- Partnership announcements: AWS partnership, Google investment disclosures
- Job postings on anthropic.com/careers (reveal what infrastructure they are building)
- Technical papers on arXiv by Anthropic researchers (reveal compute and data needs)
Focus especially on: what COMPUTE do they say they need? What SAFETY INFRASTRUCTURE? What DATA partnerships?`,

    OPENAI: `- Official blog: openai.com/blog (product launches, research updates, model releases)
- CEO/CTO interviews: Sam Altman podcasts, congressional testimony, Lex Fridman appearances, X posts
- Investor memos and partnership announcements (Microsoft, Oracle, SoftBank deals)
- Job postings on openai.com/careers
- Technical papers and model cards
Focus especially on: what INFRASTRUCTURE CONSTRAINTS does Sam Altman mention? He frequently discusses needing more chips, more power, more data centers — find the specific suppliers he signals.`,

    XAI: `- Elon Musk's public posts on X (@elonmusk) about xAI, Grok, Dojo, Neuralink, Starlink
- xAI official announcements: x.ai/blog
- Conference talks and interviews where Musk discusses Grok's compute needs or Dojo architecture
- Partnership and supply announcements for xAI Colossus supercluster
- Job postings on x.ai/careers
Focus especially on: what does Musk say he needs EXTERNALLY for Grok/Dojo/Starlink/Neuralink that he cannot source internally from Tesla or SpaceX?`,
  };

  const hints = labHints[ticker] ?? `- Official blog and research publications
- CEO/CTO interviews and conference talks
- Partnership announcements
- Job postings (reveal what they're building)
- Technical papers (reveal infrastructure needs)`;

  return `You are an investment signal extractor. ${companyName} is a PRIVATE AI company (not publicly traded). Your job is to find what ${companyName} NEEDS from external suppliers, partners, and smaller companies — NOT what they build themselves.

Search the internet for ${companyName}'s most recent public statements (last 90 days):
${hints}

Focus EXCLUSIVELY on signals where ${companyName} reveals:
1. External technology or components they are BUYING or want to buy more of
2. Infrastructure BOTTLENECKS — compute, power, cooling, networking that they can't build fast enough
3. Partnership NEEDS — types of companies they are actively seeking relationships with
4. R&D BETS on external technology they are funding, testing, or evaluating
5. Market gaps where they explicitly say smaller specialist companies will win

For each signal, extract EXACTLY this format (do not deviate):

---SIGNAL---
TYPE: [TECHNOLOGY_GAP|SUPPLY_CHAIN|PARTNERSHIP|CAPACITY|R&D_BET]
WHAT: [specific technology, component, or capability they need from external partners]
QUOTE: "[exact quote or close paraphrase — cite the source: blog post title, interview name, date]"
SPEAKER: [Name, Title, Source]
BENEFICIARY_TYPE: [specific type of smaller company that would benefit — be precise, e.g. "liquid cooling data center specialist", "custom ASIC designer", "synthetic training data provider"]
URGENCY: HIGH|MEDIUM|LOW
SOURCE_URL: [direct URL to the blog post, interview, paper, or job posting where you found this — be specific]
---END---

Extract 4-8 signals. Prioritize HIGH urgency signals where the need is explicit and near-term. Skip vague or generic statements.

IMPORTANT: Only surface signals where the beneficiary is a SMALLER EXTERNAL company — not ${companyName} itself, not other big tech firms.`;
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

Output your synthesis using EXACTLY this structure:

BLUF: [single sentence — the single most actionable insight: what specific thing does ${company} need + which specific overlooked company captures that opportunity]
TOP PICK: [ticker] — [one sentence thesis]
RANKED LIST: [all companies ranked HIGH/MEDIUM/LOW by conviction]
CROWDED TRADES: [flag any already well-known plays to avoid]
RADAR ADD: [list tickers to add to the watchlist, with the ${company} signal that triggered it]`;
}

// ── GitHub vault push ─────────────────────────────────────────────────────────

const GITHUB_TOKEN  = Deno.env.get("GITHUB_TOKEN");
const GITHUB_REPO   = "maple-maker/asymmetry-";
const GITHUB_BRANCH = "claude/opportunity-radar-research-s0VHQ";

async function pushToGitHub(path: string, content: string): Promise<string> {
  if (!GITHUB_TOKEN) { console.warn("[github] GITHUB_TOKEN not set, skipping vault push"); return ""; }
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    // Check if file already exists (to get its SHA for update)
    let sha: string | undefined;
    const getRes = await fetch(apiUrl, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
      },
    });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }
    const body: Record<string, unknown> = {
      message: `signal: add ${path}`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!putRes.ok) {
      const err = (await putRes.text()).slice(0, 200);
      console.error(`[github] push failed: ${putRes.status} ${err}`);
      return "";
    }
    console.log(`[github] pushed ${path}`);
    return path;
  } catch (e) {
    console.error(`[github] error: ${String(e)}`);
    return "";
  }
}

function generateMarkdownReport(
  ticker: string,
  company: string,
  isPublic: boolean,
  signals: Signal[],
  beneficiaries: Beneficiary[],
  synthesis: string,
  addedToWatchlist: string[],
): string {
  const date = new Date().toISOString().split("T")[0];
  const highConf = beneficiaries.filter(b => b.confidence === "HIGH");
  const blufMatch = synthesis.match(/^BLUF:\s*(.+)/im);
  const bluf = blufMatch ? blufMatch[1].trim() : "";
  const topPickMatch = synthesis.match(/TOP PICK:\s*([A-Z]+)\s*[—-]\s*(.+)/i);
  const topPickTicker = topPickMatch ? topPickMatch[1] : (highConf[0]?.ticker ?? "");
  const topPickThesis = topPickMatch ? topPickMatch[2] : (highConf[0]?.why?.slice(0, 150) ?? "");
  const sourceUrl = signals.find(s => s.source_url)?.source_url ?? "";

  const lines: string[] = [
    `# Tech Giant Signal: ${company} (${ticker}) — ${date}`,
    "",
    `**Source type:** ${isPublic ? "Earnings call / investor day / SEC filings" : "Blog posts / interviews / job postings (private company)"}`,
    "",
    "---",
    "",
    "## BLUF",
    bluf || "_No synthesis generated_",
    "",
    "---",
    "",
    `## Top Pick: $${topPickTicker}`,
    topPickThesis,
    "",
    "---",
    "",
    "## Signals Extracted",
    "",
  ];

  for (const [i, s] of signals.entries()) {
    lines.push(`### Signal ${i + 1} — [${s.urgency}] ${s.type}`);
    lines.push(`**What:** ${s.what}`);
    lines.push(`**Quote:** _"${s.quote}"_`);
    lines.push(`**Speaker:** ${s.speaker}`);
    lines.push(`**Beneficiary type:** ${s.beneficiary_type}`);
    if (s.source_url) lines.push(`**Source:** ${s.source_url}`);
    lines.push("");
  }

  lines.push("---", "", "## Beneficiary Companies", "");

  for (const b of beneficiaries) {
    lines.push(`### $${b.ticker} — ${b.name} [${b.confidence}]`);
    lines.push(`**Market cap:** ${b.market_cap}`);
    lines.push(`**Why:** ${b.why}`);
    lines.push(`**Revenue exposure:** ${b.exposure}`);
    lines.push(`**Catalyst:** ${b.catalyst}`);
    lines.push("");
  }

  lines.push("---", "", "## Full Synthesis", "", synthesis, "");

  if (addedToWatchlist.length > 0) {
    lines.push("---", "", "## Added to Radar Watchlist", "");
    for (const t of addedToWatchlist) lines.push(`- $${t}`);
    lines.push("");
  }

  if (sourceUrl) {
    lines.push("---", "", `## Primary Source`, "", sourceUrl, "");
  }

  return lines.join("\n");
}

// ── Main scan logic ───────────────────────────────────────────────────────────

async function runScan(ticker: string, company: string, isPublic: boolean): Promise<{
  scanId: number;
  signals: Signal[];
  beneficiaries: Beneficiary[];
  synthesis: string;
  addedToWatchlist: string[];
  vaultPath: string;
}> {
  console.log(`[scanner] Starting scan: ${company} (${ticker}) | public=${isPublic}`);

  // ── Venice call 1: extract signals ────────────────────────────────────────
  // Use a different prompt for private AI labs — they don't have earnings calls
  const signalPrompt = isPublic
    ? buildSignalPrompt(company, ticker)
    : buildPrivateLabSignalPrompt(company, ticker);

  const rawSignals = await callVenice(signalPrompt);
  const signals    = parseSignals(rawSignals);
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
  // Always save raw_extraction even if empty — include Venice error for debugging
  const rawExtractionParts = [rawSignals, rawBeneficiaries].filter(Boolean);
  if (rawExtractionParts.length === 0 && lastVeniceError) {
    rawExtractionParts.push(`[VENICE ERROR] ${lastVeniceError}`);
  }
  const { data: scanRow, error: scanErr } = await supabase
    .from("tech_signal_scans")
    .insert({
      company: ticker,
      event_type: isPublic ? "auto" : "private_lab",
      raw_extraction: rawExtractionParts.join("\n\n---BENEFICIARIES---\n\n") || null,
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

  // ── Push markdown report to GitHub vault ─────────────────────────────────
  const date = new Date().toISOString().split("T")[0];
  const vaultPathTarget = `vault/signals/${ticker}_${date}.md`;
  let vaultPath = "";
  if (beneficiaries.length > 0) {
    const md = generateMarkdownReport(ticker, company, isPublic, signals, beneficiaries, synthesis, addedToWatchlist);
    vaultPath = await pushToGitHub(vaultPathTarget, md);
  }

  return { scanId, signals, beneficiaries, synthesis, addedToWatchlist, vaultPath };
}

// ── Format ntfy notification ──────────────────────────────────────────────────

function formatNotification(
  company: string,
  ticker: string,
  signals: Signal[],
  beneficiaries: Beneficiary[],
  addedToWatchlist: string[],
  synthesis: string,
  isPublic: boolean,
  vaultPath: string,
): { title: string; message: string } {
  const highConf = beneficiaries.filter(b => b.confidence === "HIGH");
  const medConf  = beneficiaries.filter(b => b.confidence === "MEDIUM");

  // Extract BLUF from synthesis
  const blufMatch = synthesis.match(/^BLUF:\s*(.+)/im);
  const bluf = blufMatch ? blufMatch[1].trim() : "";

  // Extract top pick
  const topPickMatch = synthesis.match(/TOP PICK:\s*([A-Z]+)\s*[—-]\s*(.+)/i);
  const topPickTicker = topPickMatch ? topPickMatch[1] : (highConf[0]?.ticker ?? "");
  const topPickThesis = topPickMatch ? topPickMatch[2].slice(0, 120) : (highConf[0]?.why?.slice(0, 120) ?? "");

  // Best source URL from signals
  const sourceUrl = signals.find(s => s.source_url)?.source_url ?? "";

  const labTag = isPublic ? "" : " 🔒";
  const title = `📡 Tech Signal — ${ticker}${labTag} | ${beneficiaries.length} plays found`;

  const lines: string[] = [
    `📡 TECH SIGNAL — ${ticker} | ${company}${labTag}`,
    "━".repeat(34),
    "",
  ];

  // BLUF — most important section
  if (bluf) {
    lines.push("⚡ BLUF");
    lines.push(bluf);
    lines.push("");
  }

  // Top pick
  if (topPickTicker) {
    lines.push(`🎯 TOP PICK: $${topPickTicker}`);
    if (topPickThesis) lines.push(`   ${topPickThesis}`);
    lines.push("");
  }

  // All picks summary
  const highList = highConf.map(b => `$${b.ticker}`).join(", ");
  const medList  = medConf.slice(0, 4).map(b => `$${b.ticker}`).join(", ");
  lines.push(`📋 ALL PICKS (${beneficiaries.length} companies)`);
  if (highList) lines.push(`HIGH: ${highList}`);
  if (medList)  lines.push(`MED:  ${medList}`);
  lines.push("");

  // Watchlist
  if (addedToWatchlist.length > 0) {
    lines.push(`➕ ADDED TO WATCHLIST: ${addedToWatchlist.map(t => `$${t}`).join(", ")}`);
    lines.push("");
  }

  // Vault report path
  if (vaultPath) {
    lines.push(`📁 VAULT REPORT`);
    lines.push(`   ${vaultPath}`);
    lines.push("");
  }

  // Source link
  if (sourceUrl) {
    lines.push(`🔗 SOURCE`);
    lines.push(`   ${sourceUrl}`);
    lines.push("");
  }

  lines.push(`→ Next: full radar debate will run on HIGH picks.`);

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
      .select("ticker, last_scanned, scan_priority, is_public")
      .order("scan_priority", { ascending: false });
    diag.tech_giant_watchlist = watchlist;

    const { count } = await supabase
      .from("tech_signal_scans")
      .select("id", { count: "exact", head: true });
    diag.scan_count = count;

    // Venice connectivity test
    diag.venice_ping = await pingVenice();

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
  let ticker   = (body.company ?? "").toUpperCase().trim();
  let company  = "";
  let isPublic = true;

  if (ticker) {
    // Specific company requested — look up name and is_public flag
    const { data: row } = await supabase
      .from("tech_giant_watchlist")
      .select("name, is_public")
      .eq("ticker", ticker)
      .single();
    company  = row?.name ?? ticker;
    isPublic = row?.is_public ?? !PRIVATE_AI_LABS.has(ticker);
  } else {
    // Auto-pick: least recently scanned active company by priority
    const { data: rows } = await supabase
      .from("tech_giant_watchlist")
      .select("ticker, name, is_public")
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
    ticker   = rows[0].ticker;
    company  = rows[0].name;
    isPublic = rows[0].is_public ?? !PRIVATE_AI_LABS.has(ticker);
  }

  console.log(`[scanner] Scanning: ${company} (${ticker}) | is_public=${isPublic}`);

  // ── Run the scan ──────────────────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof runScan>>;
  try {
    result = await runScan(ticker, company, isPublic);
  } catch (e) {
    console.error(`[scanner] runScan failed: ${String(e)}`);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const { scanId, signals, beneficiaries, synthesis, addedToWatchlist, vaultPath } = result;

  // ── Send ntfy notification ────────────────────────────────────────────────
  if (beneficiaries.length > 0) {
    const { title, message } = formatNotification(
      company, ticker, signals, beneficiaries, addedToWatchlist, synthesis, isPublic, vaultPath,
    );
    await notify(title, message, 3);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      company,
      ticker,
      is_public: isPublic,
      scan_id: scanId,
      signals_found: signals.length,
      beneficiaries_found: beneficiaries.length,
      added_to_watchlist: addedToWatchlist,
      synthesis_length: synthesis.length,
      vault_path: vaultPath || null,
      ...(lastVeniceError ? { venice_error: lastVeniceError } : {}),
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});

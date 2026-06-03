// Function: conviction-debate | Project: jmtkygwvmrolfvwueggs
// Schedule: daily at 9:30 AM UTC via pg_cron (30 9 * * *)
// Purpose: score HIGH-confidence beneficiaries from today's transcript scan,
//          run Gemini (bull) vs DeepSeek (bear) debate, pick best candidate,
//          run full deep analysis, fire 5-message ntfy report + vault push.
//
// POST {}              → process today's scan (auto-detect latest)
// POST {"scan_id": N}  → process a specific scan
// POST {"diag": true}  → diagnostics only

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const DEEPSEEK_KEY  = Deno.env.get("DEEPSEEK_API_KEY");
const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY");
const FMP_KEY       = Deno.env.get("FMP_API_KEY");
const NTFY_TOPIC    = "asymmetry-radar";
const GEMINI_MODEL  = "gemini-2.5-flash";
const GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1beta";
const GITHUB_TOKEN  = Deno.env.get("GITHUB_TOKEN");
const GITHUB_REPO   = "maple-maker/asymmetry-";
const GITHUB_BRANCH = "claude/opportunity-radar-research-s0VHQ";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── LLM callers ───────────────────────────────────────────────────────────────

async function callGemini(prompt: string, timeoutMs = 90000): Promise<string> {
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
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) { console.error(`[gemini] HTTP ${res.status}`); return ""; }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`[gemini] ${text.length} chars`);
    return text;
  } catch (e) {
    console.error(`[gemini] ${String(e)}`);
    return "";
  }
}

async function callDeepSeek(prompt: string, timeoutMs = 60000): Promise<string> {
  if (!DEEPSEEK_KEY) return "";
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DEEPSEEK_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) { console.error(`[deepseek] HTTP ${res.status}`); return ""; }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    console.log(`[deepseek] ${text.length} chars`);
    return text;
  } catch (e) {
    console.error(`[deepseek] ${String(e)}`);
    return "";
  }
}

async function callLLM(prompt: string): Promise<string> {
  if (DEEPSEEK_KEY) {
    const r = await callDeepSeek(prompt);
    if (r) return r;
  }
  return callGemini(prompt);
}

// ── ntfy ──────────────────────────────────────────────────────────────────────

async function notify(title: string, body: string, priority = 4): Promise<void> {
  try {
    await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message: body, priority, tags: ["brain"] }),
    });
  } catch (e) { console.error(`[ntfy] ${String(e)}`); }
}

// ── FMP live data ─────────────────────────────────────────────────────────────

interface FMPSnapshot {
  ticker: string;
  price: number;
  mktCap: number;
  pe: number | null;
  eps: number | null;
  evToEbitda: number | null;
  psRatioTTM: number | null;
  pfcfRatioTTM: number | null;
  grossMarginTTM: number | null;
  revenueGrowthTTM: number | null;
  analystCount: number | null;
  description: string;
  sector: string;
  industry: string;
  beta: number | null;
}

async function getFMPSnapshot(ticker: string): Promise<FMPSnapshot | null> {
  if (!FMP_KEY) return null;
  try {
    const [profileRes, metricsRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(15000) }),
      fetch(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(15000) }),
    ]);
    const profileData = profileRes.ok ? await profileRes.json() : [];
    const metricsData = metricsRes.ok ? await metricsRes.json() : [];
    const p = Array.isArray(profileData) ? profileData[0] : null;
    const m = Array.isArray(metricsData) ? metricsData[0] : null;
    if (!p) return null;
    return {
      ticker,
      price:             p.price ?? 0,
      mktCap:            p.mktCap ?? 0,
      pe:                p.pe ?? m?.peRatioTTM ?? null,
      eps:               p.eps ?? null,
      evToEbitda:        m?.evToEbitdaTTM ?? null,
      psRatioTTM:        m?.priceToSalesRatioTTM ?? null,
      pfcfRatioTTM:      m?.priceToFreeCashFlowsRatioTTM ?? null,
      grossMarginTTM:    m?.grossProfitMarginTTM ?? null,
      revenueGrowthTTM:  m?.revenueGrowthTTM ?? null,
      analystCount:      null,
      description:       p.description ?? "",
      sector:            p.sector ?? "",
      industry:          p.industry ?? "",
      beta:              p.beta ?? null,
    };
  } catch (e) {
    console.error(`[fmp:${ticker}] ${String(e)}`);
    return null;
  }
}

// ── Conviction scoring (batch) ────────────────────────────────────────────────

interface ConvictionScores {
  asymmetry: number;   // 1-10: reward/risk ratio
  conviction: number;  // 1-10: quality of evidence
  catalyst: number;    // 1-10: binary, near-term, high-impact
  management: number;  // 1-10: track record, alignment
  overall: number;     // 0-100 weighted
  tier: number;        // 1=Exceptional, 2=High, 3=Watch
  targetPrice: number | null;
  floorPrice: number | null;
  upsidePct: number | null;
  downsidePct: number | null;
}

interface Candidate {
  ticker: string;
  name: string;
  thesis: string;
  sourceCompany: string;
  signalTheme: string;
  confidence: string;
  catalyst: string;
  snap: FMPSnapshot | null;
}

async function batchScoreCandidates(candidates: Candidate[]): Promise<Map<string, ConvictionScores>> {
  const blocks = candidates.map((c, i) => {
    const price = c.snap?.price ?? 0;
    return `CANDIDATE ${i + 1}: ${c.ticker} (${c.name})
Source signal: ${c.sourceCompany} — ${c.signalTheme}
Thesis: ${c.thesis}
Current price: $${price.toFixed(2)}
Catalyst: ${c.catalyst}
Confidence level from scanner: ${c.confidence}`;
  }).join("\n\n");

  const prompt = `You are a hedge fund analyst scoring investment candidates on four dimensions.

${blocks}

For EACH candidate, output exactly this format (one block per candidate):

TICKER: [ticker]
ASYMMETRY: [1-10]
CONVICTION: [1-10]
CATALYST_STRENGTH: [1-10]
MANAGEMENT: [1-10]
TARGET_PRICE: [$XX or N/A]
FLOOR_PRICE: [$XX or N/A]
TIER: [1=10x+ potential | 2=3-10x potential | 3=watch]
RATIONALE: [2 sentences max]
---

Scoring guide:
- Asymmetry (1-10): How lopsided is upside vs downside? 10 = massive upside, tiny downside.
- Conviction (1-10): Quality and specificity of evidence. 10 = primary source quotes, hard data.
- Catalyst Strength (1-10): How binary, near-term, high-impact? 10 = specific event within 6 months.
- Management (1-10): Track record, insider alignment, capital discipline. Use your knowledge.
- Target price = realistic bull case in 18 months. Floor = bear case if thesis fails.
- Tier 1 requires ALL four scores ≥ 8. Tier 2 requires overall ≥ 65.`;

  const raw = await callLLM(prompt);
  const scores = new Map<string, ConvictionScores>();

  const blocks2 = raw.split("---").map(b => b.trim()).filter(b => b.includes("TICKER:"));
  for (const block of blocks2) {
    const get = (key: string) => {
      const m = block.match(new RegExp(`^${key}:\\s*(.+)`, "im"));
      return m ? m[1].trim() : "";
    };
    const ticker = get("TICKER").toUpperCase().replace(/[$\s]/g, "");
    if (!ticker) continue;

    const asym  = parseInt(get("ASYMMETRY"))  || 5;
    const conv  = parseInt(get("CONVICTION")) || 5;
    const cat   = parseInt(get("CATALYST_STRENGTH")) || 5;
    const mgmt  = parseInt(get("MANAGEMENT")) || 5;
    const overall = Math.round(asym * 30 + conv * 25 + cat * 25 + mgmt * 20) / 10;
    const tier  = parseInt(get("TIER")) || 3;

    const parsePrice = (s: string): number | null => {
      const m = s.match(/[\d.]+/);
      return m ? parseFloat(m[0]) : null;
    };

    const currentPrice = candidates.find(c => c.ticker === ticker)?.snap?.price ?? 0;
    let targetPrice = parsePrice(get("TARGET_PRICE"));
    let floorPrice  = parsePrice(get("FLOOR_PRICE"));
    const upsidePct  = targetPrice && currentPrice ? Math.round(((targetPrice - currentPrice) / currentPrice) * 100) : null;
    const downsidePct = floorPrice && currentPrice ? Math.round(((currentPrice - floorPrice) / currentPrice) * 100) : null;

    scores.set(ticker, { asymmetry: asym, conviction: conv, catalyst: cat, management: mgmt, overall, tier, targetPrice, floorPrice, upsidePct, downsidePct });
  }
  return scores;
}

// ── Gemini vs DeepSeek debate (holistic — each argues BOTH sides) ─────────────
// Both models independently assess the full bull AND bear case, state their own
// verdict, then a synthesis surfaces where they agree, where they diverge, and
// why the divergence points are the most actionable information.

interface ModelAnalysis {
  bullCase: string;
  bearCase: string;
  verdict: "BULL" | "BEAR" | "NEUTRAL";
  priceTarget: string;
  worstCase: string;
  marketMiss: string;
  invalidationTrigger: string;
}

interface DebateResult {
  gemini: ModelAnalysis;
  deepseek: ModelAnalysis;
  agreement: string;
  geminiUnique: string;
  deepseekUnique: string;
  synthesis: string;
  verdict: "BULL" | "BEAR" | "NEUTRAL";
  marketMiss: string;
  invalidationTrigger: string;
}

function buildAnalysisPrompt(ticker: string, name: string, context: string, modelName: string): string {
  return `You are ${modelName}, a senior portfolio manager conducting a holistic investment analysis of ${name} (${ticker}).

${context}

Your job: evaluate this opportunity with fresh eyes. Argue BOTH sides honestly and reach your own verdict.

BULL_CASE:
[3 paragraphs — the strongest case FOR owning this: supply chain logic, revenue drivers, market position, why the thesis is credible]

BEAR_CASE:
[3 paragraphs — the strongest case AGAINST: execution risk, competition, valuation concern, what could go wrong]

MARKET_MISS: [one sentence — the single most important thing the market is mispricing, bullish OR bearish]
PRICE_TARGET: [$XX — your 18-month bull case target with the key assumption]
WORST_CASE: [$XX — your 18-month bear case floor if the thesis fails]
INVALIDATION_TRIGGER: [the specific, measurable condition that would make you exit — e.g. "HBM order cancellations exceed 20% of backlog OR gross margin falls below 45% for 2 consecutive quarters"]
VERDICT: BULL|BEAR|NEUTRAL [your honest conclusion]
CONVICTION: [1-10]`;
}

function parseModelAnalysis(raw: string): ModelAnalysis {
  const get = (key: string) => {
    const m = raw.match(new RegExp(`^${key}:\\s*(.+)`, "im"));
    return m ? m[1].trim() : "";
  };
  const getBlock = (startKey: string, endKey: string) => {
    const m = raw.match(new RegExp(`^${startKey}:\\s*\\n([\\s\\S]*?)(?=^${endKey}:|$)`, "im"));
    return m ? m[1].trim() : get(startKey);
  };

  const verdictStr = get("VERDICT").toUpperCase();
  const verdict: "BULL" | "BEAR" | "NEUTRAL" =
    verdictStr === "BULL" ? "BULL" : verdictStr === "BEAR" ? "BEAR" : "NEUTRAL";

  // Extract multi-line bull/bear blocks
  const bullMatch = raw.match(/^BULL_CASE:\s*\n([\s\S]*?)(?=^BEAR_CASE:|^MARKET_MISS:|^PRICE_TARGET:|^WORST_CASE:|$)/im);
  const bearMatch = raw.match(/^BEAR_CASE:\s*\n([\s\S]*?)(?=^BULL_CASE:|^MARKET_MISS:|^PRICE_TARGET:|^WORST_CASE:|$)/im);

  return {
    bullCase:            bullMatch?.[1]?.trim() || getBlock("BULL_CASE", "BEAR_CASE"),
    bearCase:            bearMatch?.[1]?.trim() || getBlock("BEAR_CASE", "MARKET_MISS"),
    verdict,
    priceTarget:         get("PRICE_TARGET"),
    worstCase:           get("WORST_CASE"),
    marketMiss:          get("MARKET_MISS"),
    invalidationTrigger: get("INVALIDATION_TRIGGER"),
  };
}

async function runDebate(candidate: Candidate, scores: ConvictionScores): Promise<DebateResult> {
  const mktCapStr = candidate.snap
    ? (candidate.snap.mktCap >= 1e9 ? `$${(candidate.snap.mktCap / 1e9).toFixed(1)}B` : `$${(candidate.snap.mktCap / 1e6).toFixed(0)}M`)
    : "N/A";

  const context = `Company: ${candidate.name} (${candidate.ticker})
Source signal: ${candidate.sourceCompany} — ${candidate.signalTheme}
Thesis: ${candidate.thesis}
Catalyst: ${candidate.catalyst}
Price: $${candidate.snap?.price?.toFixed(2) ?? "N/A"} | Market cap: ${mktCapStr}
P/E: ${candidate.snap?.pe?.toFixed(1) ?? "N/A"} | EV/EBITDA: ${candidate.snap?.evToEbitda?.toFixed(1) ?? "N/A"}
Gross margin: ${candidate.snap?.grossMarginTTM ? (candidate.snap.grossMarginTTM * 100).toFixed(1) + "%" : "N/A"}
Revenue growth YoY: ${candidate.snap?.revenueGrowthTTM ? (candidate.snap.revenueGrowthTTM * 100).toFixed(1) + "%" : "N/A"}`;

  const geminiPrompt  = buildAnalysisPrompt(candidate.ticker, candidate.name, context, "Gemini");
  const deepseekPrompt = buildAnalysisPrompt(candidate.ticker, candidate.name, context, "DeepSeek");

  // Both models analyze independently, in parallel — each gets its own persona prompt
  let [geminiRaw, deepseekRaw] = await Promise.all([
    callGemini(geminiPrompt, 70000),
    callDeepSeek(deepseekPrompt, 60000),
  ]);

  // If DeepSeek unavailable, run Gemini again with a different temperature directive
  if (!deepseekRaw) {
    deepseekRaw = await callGemini(
      deepseekPrompt + "\n\nNote: Be more skeptical and weight the bear case higher than usual.",
      60000
    );
  }

  const gemini   = parseModelAnalysis(geminiRaw);
  const deepseek = parseModelAnalysis(deepseekRaw);

  // Synthesis: compare where they agree vs diverge — divergence = alpha
  const synthPrompt = `You are a chief investment officer synthesizing two independent analyses of ${candidate.ticker}.

═══ GEMINI ANALYSIS ═══
Verdict: ${gemini.verdict} | Target: ${gemini.priceTarget} | Floor: ${gemini.worstCase}
Bull: ${gemini.bullCase.slice(0, 500)}
Bear: ${gemini.bearCase.slice(0, 500)}
Market miss: ${gemini.marketMiss}
Invalidation: ${gemini.invalidationTrigger}

═══ DEEPSEEK ANALYSIS ═══
Verdict: ${deepseek.verdict} | Target: ${deepseek.priceTarget} | Floor: ${deepseek.worstCase}
Bull: ${deepseek.bullCase.slice(0, 500)}
Bear: ${deepseek.bearCase.slice(0, 500)}
Market miss: ${deepseek.marketMiss}
Invalidation: ${deepseek.invalidationTrigger}

Your job: find where they agree (high confidence), where they diverge (the alpha), and reach a final verdict.

AGREEMENT: [1-2 sentences — what both models agree on, bull AND bear]
GEMINI_UNIQUE: [what Gemini sees that DeepSeek misses — the strongest point only]
DEEPSEEK_UNIQUE: [what DeepSeek sees that Gemini misses — the strongest point only]
DECISIVE_FACTOR: [the single most important unresolved question — what would tip your verdict]
MARKET_MISS: [one sentence — the most actionable mispricing insight from the combined analysis]
INVALIDATION_TRIGGER: [the sharpest, most specific exit condition from either analysis]
VERDICT: BULL|BEAR|NEUTRAL
SYNTHESIS: [3 sentences — the integrated view, weighting the best arguments from each model]`;

  const synthRaw = await callGemini(synthPrompt, 60000);

  const get = (key: string, text: string) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)`, "im"));
    return m ? m[1].trim() : "";
  };
  const getBlock = (key: string, text: string) => {
    const m = text.match(new RegExp(`^${key}:\\s*\\n([\\s\\S]*?)(?=^[A-Z_]+:|$)`, "im"));
    return m ? m[1].trim() : get(key, text);
  };

  const verdictStr = get("VERDICT", synthRaw).toUpperCase();
  const verdict: "BULL" | "BEAR" | "NEUTRAL" =
    verdictStr === "BULL" ? "BULL" : verdictStr === "BEAR" ? "BEAR" : "NEUTRAL";

  return {
    gemini,
    deepseek,
    agreement:         get("AGREEMENT", synthRaw),
    geminiUnique:      get("GEMINI_UNIQUE", synthRaw),
    deepseekUnique:    get("DEEPSEEK_UNIQUE", synthRaw),
    synthesis:         get("SYNTHESIS", synthRaw) || getBlock("SYNTHESIS", synthRaw),
    verdict,
    marketMiss:        get("MARKET_MISS", synthRaw) || gemini.marketMiss,
    invalidationTrigger: get("INVALIDATION_TRIGGER", synthRaw) || gemini.invalidationTrigger || deepseek.invalidationTrigger,
  };
}

// ── Deep analysis ─────────────────────────────────────────────────────────────

interface DeepAnalysis {
  businessModel: string;
  moat: string;
  competitors: string[];
  catalysts: string;
  bearFlags: string;
  peerTable: string;
}

async function runDeepAnalysis(candidate: Candidate): Promise<DeepAnalysis> {
  const context = `Company: ${candidate.name} (${candidate.ticker})
Sector signal source: ${candidate.sourceCompany}
Thesis: ${candidate.thesis}
Catalyst: ${candidate.catalyst}`;

  const bmMoatPrompt = `Analyze ${candidate.name} (${candidate.ticker}).
${context}

BUSINESS_MODEL: [2-3 sentences in plain English — how they actually make money, revenue streams, customer concentration, contract structure]

TOP_COMPETITORS: [Competitor1] | [Competitor2] | [Competitor3]

MOAT: [2-3 sentences — does ${candidate.ticker} have a durable edge that rivals cannot copy in 3-5 years? Name it precisely: patent portfolio, switching costs, network effects, proprietary data, or cost structure.]`;

  const catalystBearPrompt = `Analyze ${candidate.name} (${candidate.ticker}) for upcoming catalysts and risks.
${context}

CATALYSTS:
① [catalyst] — [timing]
② [catalyst] — [timing]
③ [catalyst] — [timing]

RED_FLAG_1_SEVERITY: HIGH|MEDIUM|LOW
RED_FLAG_1: [description] — Source: [filing/date]
RED_FLAG_2_SEVERITY: HIGH|MEDIUM|LOW
RED_FLAG_2: [description] — Source: [filing/date]
RED_FLAG_3_SEVERITY: HIGH|MEDIUM|LOW
RED_FLAG_3: [description] — Source: [filing/date]

BEAR_VERDICT: [Does the bull thesis hold given these risks? One sentence.]

PEER_TABLE: Compare ${candidate.ticker} vs its two closest competitors on: P/S TTM | P/FCF | EV/EBITDA | Gross Margin | YoY Revenue Growth
Format as: METRIC | ${candidate.ticker} | PEER1 | PEER2`;

  // Run both in parallel
  const [bmMoatRaw, catalystBearRaw] = await Promise.all([
    callLLM(bmMoatPrompt),
    callGemini(catalystBearPrompt, 70000),
  ]);

  const get = (key: string, text: string) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)`, "im"));
    return m ? m[1].trim() : "";
  };

  const competitorStr = get("TOP_COMPETITORS", bmMoatRaw);
  const competitors = competitorStr.split("|").map(s => s.trim()).filter(Boolean);

  return {
    businessModel: get("BUSINESS_MODEL", bmMoatRaw),
    moat:          get("MOAT", bmMoatRaw),
    competitors,
    catalysts:     catalystBearRaw.match(/CATALYSTS:([\s\S]*?)(?=RED_FLAG_1|$)/i)?.[1]?.trim() ?? "",
    bearFlags:     catalystBearRaw,
    peerTable:     catalystBearRaw.match(/PEER_TABLE:([\s\S]*?)$/i)?.[1]?.trim() ?? "",
  };
}

// ── 5-message ntfy notification ───────────────────────────────────────────────

function buildProgressBar(score: number, max = 10): string {
  const filled = Math.round((score / max) * 8);
  return "█".repeat(filled) + "░".repeat(8 - filled);
}

async function sendSingleAlert(
  candidate: Candidate,
  scores: ConvictionScores,
  debate: DebateResult,
  analysis: DeepAnalysis,
  vaultPath: string,
): Promise<void> {
  const t = candidate.ticker;
  const tierLabel = scores.tier === 1 ? "TIER 1 — EXCEPTIONAL" : scores.tier === 2 ? "TIER 2 — HIGH CONVICTION" : "TIER 3 — WATCH";
  const tierEmoji = scores.tier === 1 ? "🔺" : scores.tier === 2 ? "🟡" : "⚪";
  const gV = debate.gemini.verdict === "BULL" ? "🟢 BULL" : debate.gemini.verdict === "BEAR" ? "🔴 BEAR" : "🟡 NEUTRAL";
  const dV = debate.deepseek.verdict === "BULL" ? "🟢 BULL" : debate.deepseek.verdict === "BEAR" ? "🔴 BEAR" : "🟡 NEUTRAL";
  const cioV = debate.verdict === "BULL" ? "🟢 BULL" : debate.verdict === "BEAR" ? "🔴 BEAR" : "🟡 NEUTRAL";

  // Business model: first 2 sentences from LLM or fall back to thesis
  const bizModel = (() => {
    const raw = analysis.businessModel || candidate.thesis;
    const sentences = raw.replace(/\n/g, " ").match(/[^.!?]+[.!?]+/g) ?? [];
    return sentences.slice(0, 2).join(" ").trim() || raw.slice(0, 200);
  })();

  const msg = [
    `${tierEmoji} ${tierLabel} — $${t}  |  ${candidate.name}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "⚡ BLUF",
    debate.marketMiss.slice(0, 280),
    "",
    "📡 SOURCE",
    `${candidate.sourceCompany} → ${candidate.signalTheme || candidate.catalyst.slice(0, 100)}`,
    "",
    "🎯 TAKEAWAY",
    debate.synthesis.slice(0, 200),
    "",
    "🏢 BUSINESS MODEL",
    bizModel,
    "",
    `📊 SCORE  ${scores.overall.toFixed(0)}/100  |  ${tierLabel}`,
    `  Asymmetry ${scores.asymmetry}/10 · Conviction ${scores.conviction}/10 · Catalyst ${scores.catalyst}/10 · Mgmt ${scores.management}/10`,
    `  Debate: Gemini=${gV} | DeepSeek=${dV} | CIO=${cioV}`,
    "",
    vaultPath ? `📁 FULL REPORT\n  ${vaultPath}` : "📁 FULL REPORT\n  (vault push failed — check logs)",
  ].join("\n");

  const priority = scores.tier === 1 ? 5 : 4;
  await notify(`${tierEmoji} $${t} — ${scores.overall.toFixed(0)}/100 | ${debate.verdict}`, msg, priority);
}

// ── GitHub vault push ─────────────────────────────────────────────────────────

async function pushVault(path: string, content: string): Promise<string> {
  if (!GITHUB_TOKEN) return "";
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    const existingRes = await fetch(apiUrl + `?ref=${GITHUB_BRANCH}`, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "asymmetry-radar",
      },
      signal: AbortSignal.timeout(10000),
    });
    const existing = existingRes.ok ? await existingRes.json() : null;
    const encoded = btoa(unescape(encodeURIComponent(content)));
    const body: Record<string, string> = {
      message: `conviction-debate: ${path}`,
      content: encoded,
      branch: GITHUB_BRANCH,
    };
    if (existing?.sha) body.sha = existing.sha;
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "asymmetry-radar",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!putRes.ok) {
      console.error(`[github] PUT ${putRes.status}: ${(await putRes.text()).slice(0, 200)}`);
      return "";
    }
    console.log(`[github] pushed ${path}`);
    return path;
  } catch (e) {
    console.error(`[github] ${String(e)}`);
    return "";
  }
}

function generateDebateReport(
  candidate: Candidate,
  scores: ConvictionScores,
  debate: DebateResult,
  analysis: DeepAnalysis,
): string {
  const snap = candidate.snap;
  const fmtNum = (n: number | null, suffix = "", dec = 1) => n != null ? `${n.toFixed(dec)}${suffix}` : "N/A";
  const mktCapStr = snap ? (snap.mktCap >= 1e9 ? `$${(snap.mktCap / 1e9).toFixed(1)}B` : `$${(snap.mktCap / 1e6).toFixed(0)}M`) : "N/A";
  const date = new Date().toISOString().slice(0, 10);

  return `# Conviction Debate Report: ${candidate.ticker} — ${date}

**Source signal:** ${candidate.sourceCompany} → ${candidate.signalTheme}
**Debate verdict:** ${debate.verdict} | **Overall score:** ${scores.overall.toFixed(0)}/100 | **Tier:** ${scores.tier}

---

## BLUF
${debate.marketMiss}

---

## Conviction Scores

| Dimension | Score | Bar |
|---|---|---|
| Asymmetry | ${scores.asymmetry}/10 | ${buildProgressBar(scores.asymmetry)} |
| Conviction | ${scores.conviction}/10 | ${buildProgressBar(scores.conviction)} |
| Catalyst Strength | ${scores.catalyst}/10 | ${buildProgressBar(scores.catalyst)} |
| Management Quality | ${scores.management}/10 | ${buildProgressBar(scores.management)} |
| **Overall** | **${scores.overall.toFixed(0)}/100** | |

Entry: $${snap?.price?.toFixed(2) ?? "N/A"} | Target: ${scores.targetPrice ? `$${scores.targetPrice}` : "N/A"} | Floor: ${scores.floorPrice ? `$${scores.floorPrice}` : "N/A"}

---

## Gemini — Full Analysis (Bull + Bear)

**Verdict:** ${debate.gemini.verdict} | **Target:** ${debate.gemini.priceTarget} | **Floor:** ${debate.gemini.worstCase}

**Bull Case:**
${debate.gemini.bullCase || "(not generated)"}

**Bear Case:**
${debate.gemini.bearCase || "(not generated)"}

**Market miss:** ${debate.gemini.marketMiss}
**Invalidation:** ${debate.gemini.invalidationTrigger}

---

## DeepSeek — Full Analysis (Bull + Bear)

**Verdict:** ${debate.deepseek.verdict} | **Target:** ${debate.deepseek.priceTarget} | **Floor:** ${debate.deepseek.worstCase}

**Bull Case:**
${debate.deepseek.bullCase || "(not generated)"}

**Bear Case:**
${debate.deepseek.bearCase || "(not generated)"}

**Market miss:** ${debate.deepseek.marketMiss}
**Invalidation:** ${debate.deepseek.invalidationTrigger}

---

## Synthesis — Where They Agree vs Diverge

**Agreement (high confidence):** ${debate.agreement}

**Gemini sees (unique insight):** ${debate.geminiUnique}

**DeepSeek sees (unique insight):** ${debate.deepseekUnique}

**CIO Synthesis:**
${debate.synthesis}

**Final Verdict:** ${debate.verdict}

**Invalidation trigger:** ${debate.invalidationTrigger}

---

## Business Model

${analysis.businessModel}

**Top competitors:** ${analysis.competitors.join(" | ")}

## Moat

${analysis.moat}

---

## Catalysts (Next 12 Months)

${analysis.catalysts}

---

## Financial Snapshot

| Metric | Value |
|---|---|
| Price | $${snap?.price?.toFixed(2) ?? "N/A"} |
| Market Cap | ${mktCapStr} |
| P/E (TTM) | ${fmtNum(snap?.pe ?? null)} |
| EV/EBITDA | ${fmtNum(snap?.evToEbitda ?? null)} |
| P/S (TTM) | ${fmtNum(snap?.psRatioTTM ?? null)} |
| P/FCF | ${fmtNum(snap?.pfcfRatioTTM ?? null)} |
| Gross Margin | ${snap?.grossMarginTTM ? (snap.grossMarginTTM * 100).toFixed(1) + "%" : "N/A"} |
| Rev Growth YoY | ${snap?.revenueGrowthTTM ? (snap.revenueGrowthTTM * 100).toFixed(1) + "%" : "N/A"} |
| Beta | ${snap?.beta?.toFixed(2) ?? "N/A"} |
| Sector | ${snap?.sector ?? "N/A"} |

---

## Bear Case — 3 Red Flags

${analysis.bearFlags}

---

## Peer Comparison

${analysis.peerTable}

---

*Generated by conviction-debate · ${new Date().toISOString()}*
`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (body.diag) {
    return Response.json({
      deepseek_key: !!DEEPSEEK_KEY,
      gemini_key: !!GEMINI_KEY,
      fmp_key: !!FMP_KEY,
      github_token: !!GITHUB_TOKEN,
    });
  }

  try {
    // 1. Fetch candidates from today's scan (or specified scan_id)
    let query = supabase
      .from("signal_opportunities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (body.scan_id) {
      query = query.eq("scan_id", body.scan_id);
    } else {
      // Default: last 3 hours (catches 9 AM scan when running at 9:30 AM)
      const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", cutoff);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(`DB fetch: ${error.message}`);

    let candidates = (rows ?? []).filter(r => r.confidence === "HIGH");
    if (candidates.length === 0) {
      candidates = (rows ?? []).filter(r => r.confidence === "MEDIUM");
    }
    if (candidates.length === 0) {
      return Response.json({ status: "no_candidates", message: "No candidates found in recent scans. Run transcript-scanner first." });
    }

    // De-duplicate by ticker (keep first/highest confidence)
    const seen = new Set<string>();
    const unique = candidates.filter(r => {
      const t = r.beneficiary_ticker?.toUpperCase();
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    console.log(`[debate] ${unique.length} unique candidates: ${unique.map(r => r.beneficiary_ticker).join(", ")}`);

    // 2. Fetch FMP snapshots in parallel for all candidates
    const snapMap = new Map<string, FMPSnapshot | null>();
    await Promise.all(unique.map(async r => {
      const snap = await getFMPSnapshot(r.beneficiary_ticker);
      snapMap.set(r.beneficiary_ticker, snap);
    }));

    // 3. Build Candidate objects
    const candidateObjs: Candidate[] = unique.map(r => ({
      ticker:       r.beneficiary_ticker,
      name:         r.beneficiary_name,
      thesis:       r.thesis,
      sourceCompany: r.source_company,
      signalTheme:  r.signal_theme || "",
      confidence:   r.confidence,
      catalyst:     r.catalyst || "",
      snap:         snapMap.get(r.beneficiary_ticker) ?? null,
    }));

    // 4. Batch score all candidates
    console.log("[debate] batch scoring...");
    const scoreMap = await batchScoreCandidates(candidateObjs);

    // Sort by overall score, pick winner
    const ranked = candidateObjs
      .map(c => ({ candidate: c, scores: scoreMap.get(c.ticker) ?? { asymmetry: 5, conviction: 5, catalyst: 5, management: 5, overall: 50, tier: 3, targetPrice: null, floorPrice: null, upsidePct: null, downsidePct: null } }))
      .sort((a, b) => b.scores.overall - a.scores.overall);

    const winner = ranked[0];
    const MIN_SCORE = 75;
    console.log(`[debate] winner: ${winner.candidate.ticker} (${winner.scores.overall.toFixed(0)}/100)`);

    if (winner.scores.overall < MIN_SCORE) {
      console.log(`[debate] top score ${winner.scores.overall.toFixed(0)} < ${MIN_SCORE} — skipping debate, no notification`);
      return Response.json({
        status: "below_threshold",
        threshold: MIN_SCORE,
        top_score: winner.scores.overall,
        winner: winner.candidate.ticker,
        all_ranked: ranked.map(r => ({ ticker: r.candidate.ticker, score: r.scores.overall.toFixed(0) })),
      });
    }

    // 5. Run Gemini vs DeepSeek debate on the winner
    console.log("[debate] running bull vs bear debate...");
    const debate = await runDebate(winner.candidate, winner.scores);
    console.log(`[debate] verdict: ${debate.verdict}`);

    // 6. Deep analysis (parallel LLM calls)
    console.log("[debate] running deep analysis...");
    const analysis = await runDeepAnalysis(winner.candidate);

    // 7. Push vault report
    const date = new Date().toISOString().slice(0, 10);
    const vaultPathTarget = `vault/debates/${winner.candidate.ticker}_${date}.md`;
    const md = generateDebateReport(winner.candidate, winner.scores, debate, analysis);
    const vaultPath = await pushVault(vaultPathTarget, md);

    // 8. Send single-message ntfy alert
    console.log("[debate] sending ntfy alert...");
    await sendSingleAlert(winner.candidate, winner.scores, debate, analysis, vaultPath);

    // 9. Persist result to DB
    await supabase.from("conviction_debates").insert({
      ticker:           winner.candidate.ticker,
      company_name:     winner.candidate.name,
      source_scan_id:   unique[0]?.scan_id ?? null,
      overall_score:    winner.scores.overall,
      tier:             winner.scores.tier,
      debate_verdict:   debate.verdict,
      market_miss:      debate.marketMiss,
      invalidation:     debate.invalidationTrigger,
      vault_path:       vaultPath || null,
      all_candidates:   ranked.map(r => ({ ticker: r.candidate.ticker, score: r.scores.overall })),
    }).then(({ error: e }) => { if (e) console.warn(`[db] insert warning: ${e.message}`); });

    return Response.json({
      status: "ok",
      winner: winner.candidate.ticker,
      overall_score: winner.scores.overall,
      tier: winner.scores.tier,
      verdict: debate.verdict,
      market_miss: debate.marketMiss,
      vault_path: vaultPath || null,
      all_ranked: ranked.map(r => ({ ticker: r.candidate.ticker, score: r.scores.overall.toFixed(0) })),
    });

  } catch (e) {
    console.error(`[debate] fatal: ${String(e)}`);
    return Response.json({ status: "error", error: String(e) }, { status: 500 });
  }
});

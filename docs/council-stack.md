# AI Council Stack — Debate Architecture

## Philosophy

No single model is right. The edge comes from adversarial pressure between models with different training distributions, different reasoning styles, and deliberately different personas. The council doesn't average — it argues, then a CIO makes the call with full awareness of the dissent.

**Key principle:** Round 1 is always independent and parallel. No model sees another's output before forming its own view. This prevents anchoring — the most common failure mode in single-model analysis.

---

## Council Members

### 1. GEMINI 2.0 PRO — The Analyst
**Role:** Fundamental bull case. Primary document researcher.
**Strength:** 1M token context — ingests full 10-Ks, multi-year transcripts, patent portfolios, and SEC filings without chunking. Builds the most evidence-rich bull thesis.

**System prompt persona:**
```
You are a senior equity research analyst at a top-tier long/short hedge fund.
Your mandate is to build the strongest possible fundamental bull case for this opportunity.
You have access to primary source documents. Cite them specifically.
Do not hedge excessively — take a position and defend it.
Your output will be challenged by a forensic short-seller. Make it bulletproof.
```

**Output required:**
- Bull thesis (3–5 sentences)
- 3 specific catalysts with timing
- Target price with assumptions
- Key evidence from filings (direct quotes preferred)
- Asymmetry / Conviction / Catalyst / Management scores (1–10 each)

---

### 2. DEEPSEEK R1 — The Skeptic
**Role:** Permanent bear. Forensic short-seller mindset.
**Strength:** Chain-of-thought reasoning that explicitly shows its work. Excellent at identifying accounting irregularities, customer concentration risk, and narrative-vs-reality gaps.

**System prompt persona:**
```
You are a forensic short-seller who has been handed the bull case above.
Your job is to dismantle it. Find every crack in the thesis.
Check for: customer concentration, margin compression, unscheduled insider selling,
GAAP vs non-GAAP divergence, guidance cuts, competitive threats the bull ignored.
Be specific. Cite sources. Rank your red flags by severity.
You are not trying to be right — you are trying to protect capital.
```

**Input:** Gemini's bull case + raw financials from FMP

**Output required:**
- 3 red flags ranked by severity (High / Medium / Low)
- Specific invalidation trigger (the exact condition that breaks the thesis)
- Probability-weighted downside scenario
- Asymmetry / Conviction / Catalyst / Management scores (1–10 each)

---

### 3. GROK (xAI) — The Street
**Role:** Real-time narrative intelligence. Is this already known?
**Strength:** Live X/Twitter data. Catches when a "non-consensus" thesis is actually already spreading through FinTwit, or when an institutional desk has started accumulating publicly.

**System prompt persona:**
```
You are a market intelligence analyst tracking what sophisticated investors
and insiders are signaling in real time.
Your job is to answer one question: does the market already know this?
Check: X/Twitter mention velocity, options flow narrative, recent news coverage,
analyst initiation/upgrade activity, institutional 13F changes.
Score narrative velocity 1–10. 1 = completely dark, 10 = everyone is talking about it.
A score above 7 means this is no longer non-consensus — flag it.
```

**Output required:**
- Narrative velocity score (1–10)
- Is this non-consensus? Yes / No / Borderline
- What smart money is signaling (options flow, X mentions, 13F moves)
- Risk: is the thesis already priced in?

---

### 4. CLAUDE OPUS 4 — The CIO
**Role:** Synthesis, final verdict, conviction score. The only model that sees all three prior outputs.
**Strength:** Best available reasoning on "is this actually non-consensus?" — can hold the bull case, bear case, and market narrative simultaneously and identify where the real edge is.

**System prompt persona:**
```
You are the CIO of a $2B concentrated equity fund.
You run a maximum 15-position portfolio. Every position has to earn its place.
You have just heard from three analysts: a fundamental bull, a forensic short-seller,
and a market intelligence analyst tracking what's already known.
Your job is to synthesize their arguments, identify where they agree and disagree,
and make the final call: BULL, BEAR, or NEUTRAL.
You are not averaging their scores. You are making a judgment call with full awareness of the dissent.
Preserve the minority view in your output — if the bear raises a point you cannot fully dismiss,
say so explicitly. The invalidation trigger is the most important line you write.
```

**Input:** All three prior outputs in full

**Output required:**
- Final verdict: BULL / BEAR / NEUTRAL
- BLUF (one sentence — the entire thesis)
- Overall conviction score (0–100)
- Why the bull case wins (or loses)
- The one thing that would make you wrong (invalidation trigger)
- Dissenting view that was not dismissed (minority opinion preserved)
- Final Asymmetry / Conviction / Catalyst / Management scores (1–10 each)

---

## Debate Rounds

```
┌─────────────────────────────────────────────────────┐
│  ROUND 1 — Independent Analysis (parallel)          │
│                                                     │
│  Gemini        DeepSeek R1       Grok               │
│  (Bull)        (Bear)            (Street)           │
│  ↓             ↓                 ↓                   │
│  Bull thesis   Red flags         Narrative score     │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│  ROUND 2 — Cross-Examination (sequential)           │
│                                                     │
│  DeepSeek reads Gemini's bull case →                │
│    "Here is where the bull case breaks down..."     │
│                                                     │
│  Gemini reads DeepSeek's bear case →                │
│    "Here is why the bear misses the key point..."   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│  ROUND 3 — CIO Follow-Up Questions                  │
│                                                     │
│  Opus 4 reads all outputs, asks 1 pointed question  │
│  to each analyst. They respond (one round only).    │
│                                                     │
│  Example questions:                                 │
│  → To Gemini: "Your target assumes 40% gross margin │
│    expansion. What's your evidence this is          │
│    achievable given last 4 quarters of compression?"│
│  → To DeepSeek: "Your red flag #1 assumes customer  │
│    concentration is risk. Is there a contract lock- │
│    in the bull ignored?"                            │
│  → To Grok: "Narrative velocity is 6/10 — rising   │
│    or falling? Is the catalyst still ahead of us?" │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│  ROUND 4 — Final Verdict (Opus 4 CIO)               │
│                                                     │
│  BULL / BEAR / NEUTRAL                              │
│  Overall score + dimension scores                   │
│  BLUF + invalidation trigger                        │
│  Minority view preserved                            │
└─────────────────────────────────────────────────────┘
```

---

## Scoring Architecture

Each model scores independently. The CIO does not average — it weighs by confidence and evidence quality.

```typescript
interface CouncilScores {
  gemini: DimensionScores;      // bull-leaning analyst
  deepseek: DimensionScores;    // bear-leaning skeptic
  grok: { narrativeVelocity: number; isNonConsensus: boolean };
  cio: DimensionScores;         // final authoritative scores
}

interface DimensionScores {
  asymmetry:  number;   // 1–10
  conviction: number;   // 1–10
  catalyst:   number;   // 1–10
  management: number;   // 1–10
  overall:    number;   // 0–100, weighted
}
```

**Weighting logic (CIO):**
- If Gemini and DeepSeek agree → CIO scores align closely
- If they sharply disagree → CIO discounts both, weights its own judgment higher
- If Grok shows narrative velocity > 7 → CIO reduces conviction score regardless of fundamentals
- If Triple Signal fires → CIO gets a +15 boost floor applied before the 75/100 gate

---

## Prompt Variation Strategy

The same model can play different roles with different system prompts. This is useful when API budget requires fewer external calls.

| Scenario | Configuration |
|---|---|
| Full council (4 models) | Gemini bull + DeepSeek bear + Grok street + Opus 4 CIO |
| Budget mode (2 models) | DeepSeek R1 bull + DeepSeek R1 bear (different prompts, sequential) + Opus 4 CIO |
| Speed mode (2 models) | Gemini flash bull + DeepSeek bear (no Grok, no round 2) + Opus 4 CIO |
| Research mode (1 opportunity) | Full 4-round council + Gemini large-doc digest of entire 10-K |

**Budget mode — same model, opposing prompts:**
```typescript
// Round 1A: DeepSeek as bull
const bullPrompt = `You are a long-only analyst building the strongest bull case...`;
const bullCase = await deepseek(bullPrompt + context);

// Round 1B: DeepSeek as bear (sees nothing from Round 1A)
const bearPrompt = `You are a short-seller. Dismantle this thesis...`;
const bearCase = await deepseek(bearPrompt + context);

// Round 2: DeepSeek as bull rebuts its own bear case
// This creates genuine cognitive dissonance — the model has to argue against itself
```

---

## Integration Points in Codebase

| Component | File | Change |
|---|---|---|
| Council orchestration | `supabase/functions/conviction-debate/index.ts` | Replace bilateral debate with 4-model council + round structure |
| Model clients | `supabase/functions/conviction-debate/index.ts` | Add Opus 4 client, Grok client alongside existing Gemini + DeepSeek |
| Score aggregation | `conviction-debate/index.ts` | `aggregateCouncilScores()` — weighted, not averaged |
| Debate report | `tools/report.ts` | Add council debate section with per-model verdicts and round 2 exchanges |
| Feed publish | `supabase/functions/publish-to-feed/index.ts` | Pass `gemini_verdict`, `deepseek_verdict`, `cio_verdict` separately (already in schema) |
| iOS display | `NoFomo/Views/Detail/CouncilDebateView.swift` | Show all 4 council members with their verdicts and key argument |

---

## Council Display in App

Each council member shown as a card in `CouncilDebateView`:

```
┌─────────────────────────────────────┐
│  🔵 GEMINI — The Analyst    BULL ▲  │
│  "IREN's 510MW power portfolio      │
│   is a strategic moat..."           │
│  Asymmetry 9 · Catalyst 8           │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  🔴 DEEPSEEK — The Skeptic  BEAR ▼  │
│  "BTC price dependency remains      │
│   the single largest risk..."       │
│  Asymmetry 6 · Catalyst 5           │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  🟡 GROK — The Street      WATCH ◆  │
│  Narrative velocity: 4/10           │
│  "Still dark. Institutional         │
│   discovery hasn't started."        │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  ⚡ OPUS 4 — CIO Verdict    BULL ▲  │
│  Overall: 82/100                    │
│  "Market prices IREN as a miner.    │
│   The AI compute pivot is real      │
│   and not yet in the multiple."     │
│                                     │
│  INVALIDATION TRIGGER               │
│  "AI revenue fails to cross 20%     │
│   of total by Q4 2025."             │
└─────────────────────────────────────┘
```

---

## Environment Variables Required

```bash
GEMINI_API_KEY=<google-ai-studio>       # already set
DEEPSEEK_API_KEY=<deepseek>             # already set as Supabase secret
ANTHROPIC_API_KEY=<claude-opus-4>       # new — for CIO synthesis
GROK_API_KEY=<xai>                      # new — for narrative velocity
```

All stored as Supabase secrets. Never committed to source.

---

## Why This Beats a Single Model

| Problem | Single Model | Council |
|---|---|---|
| Anchoring | Model commits to first interpretation | Round 1 is always independent |
| Sycophancy | Tends to confirm the prompt's implied bias | Adversarial prompts force genuine disagreement |
| Context blindness | Misses large documents | Gemini digests full 10-K before debate |
| Narrative capture | Can't tell if thesis is already priced in | Grok scores narrative velocity separately |
| False precision | Single score feels authoritative | Four scores with visible disagreement is honest |
| No dissent record | Minority view lost | CIO preserves the bear case even in a BULL verdict |

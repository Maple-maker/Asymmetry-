# Alpha Stack — Research & Discovery Architecture

## Discovery Layer — find the signal before it's priced in

| Source | Why | API |
|---|---|---|
| **Exa** | Neural semantic search built for AI agents — finds "companies with new DoD contracts in autonomous systems" not just keyword matches | `exa.ai` |
| **Quiver Quantitative** | Congressional trades + DoD contracts + SEC filings in one feed. Politicians buying = leading indicator | `quiverquant.com` |
| **SEC EDGAR** | Direct Form 4 insider filings, 8-Ks, 10-Ks — no intermediary | Free, official |
| **SAM.gov** | Federal contract awards direct from source | Free, official |
| **Unusual Whales** | Options flow — smart money moves options before the stock. Dark pool prints too | `unusualwhales.com` |

---

## LLM Layer — debate architecture

| Role | Model | Why |
|---|---|---|
| **CIO / Synthesizer** | Claude Opus 4 | Best nuanced financial reasoning, 200k context, strongest at "is this actually non-consensus?" |
| **Bull Advocate** | Gemini 2.0 Pro | 1M context — feeds full 10-Ks, earnings transcripts, patent filings without chunking |
| **Bear / Skeptic** | DeepSeek R1 | Purpose-built reasoning, excellent at poking holes in theses, cheap to run at scale |
| **Real-time Sentiment** | Grok (xAI) | Live X/Twitter data — catches narrative shifts and positioning before price moves |

---

## Pipeline Architecture

### Current flow
```
transcript-scanner → conviction-debate (Gemini vs DeepSeek) → publish-to-feed
```

### Upgraded flow
```
Exa search + Quiver + SAM.gov
        ↓
   FMP screening (price, market cap, insider signal)
        ↓
Unusual Whales options flow check  ← new leading indicator layer
        ↓
Gemini 2.0 (full document digest — 10-K, transcript, patents)
        ↓
Opus 4 (CIO) vs DeepSeek R1 (bear) bilateral debate
        ↓
Grok sentiment pulse  ← is the market starting to notice?
        ↓
Triple Signal scoring → 75/100 gate → publish
```

---

## Implementation Priority

### 1. Exa (highest leverage for discovery)
Replace generic web search in `transcript-scanner`. Single API call returns exactly the right documents with citations already attached. Semantic search means "AI infrastructure play under $2B market cap" returns actual candidates, not SEO noise.

**Integration point:** `supabase/functions/transcript-scanner/index.ts` — replace fetch calls with Exa neural search.

### 2. Quiver Quantitative (highest-quality leading indicator)
Congressional trading data has documented alpha and is not in the current pipeline. Politicians buying ahead of regulatory decisions, DoD contract awards before public announcement — this is the signal.

**Endpoints to use:**
- `/beta/bulk/congresstrading` — recent congressional trades
- `/beta/bulk/govcontract` — DoD/government contract awards
- `/beta/bulk/sec13f` — institutional position changes

**Integration point:** Add as a fourth input to `analyzeTripleSignal()` in `conviction-debate`. Congressional buying = smart money score boost on top of Form 4 insider signal.

### 3. Unusual Whales (options flow as fourth Triple Signal dimension)
Options market leads stock moves by days to weeks. Unusual call buying — especially out-of-the-money, short-dated — is the most reliable leading indicator of institutional positioning. Dark pool prints confirm accumulation.

**Integration point:** Extend `TripleSignal` interface with `optionsFlow` dimension. Unusual call sweep on a low-conviction candidate bumps it into the debate queue.

### 4. Claude Opus 4 as CIO (raise the debate ceiling)
Swap the current synthesis step from the existing model to Opus 4. The debate quality ceiling — specifically the "is this actually non-consensus?" and invalidation trigger generation — improves significantly.

**Integration point:** `conviction-debate/index.ts` — update the `MODELS` constant for the CIO synthesis call.

### 5. Grok for real-time sentiment (timing layer)
Secondary signal — useful for timing entry alerts rather than initial discovery. If the radar found something 3 weeks ago and Grok now shows the narrative starting to spread on X, that's the alert to send.

**Integration point:** New function `checkNarrativeVelocity(ticker)` called before the ntfy alert fires. If Grok shows rising mention velocity, escalate the alert priority to 5.

---

## What to Skip

| Tool | Reason |
|---|---|
| **Perplexity** | Good for consumer search, weak for structured financial data retrieval |
| **OpenAI o1/o3** | Opus 4 + DeepSeek R1 covers the same ground cheaper with better financial domain performance |
| **Bloomberg / Refinitiv** | Enterprise pricing — same data available through FMP + EDGAR for this use case |
| **LangChain / LlamaIndex** | Unnecessary abstraction layer — direct API calls keep latency low and costs visible |

---

## Environment Variables to Add

```bash
EXA_API_KEY=<from exa.ai>
QUIVER_API_KEY=<from quiverquant.com>
UNUSUAL_WHALES_API_KEY=<from unusualwhales.com>
GROK_API_KEY=<from x.ai>
# Upgrade conviction-debate to use Opus 4 for CIO synthesis
# GEMINI_API_KEY already set — upgrade to gemini-2.0-pro model string
```

Store all keys as Supabase secrets — never commit to source.

---

## Signal Quality Hierarchy

Ranked by alpha half-life (how long before the market prices it in):

1. **Congressional trading** — days to weeks before public awareness
2. **Unusual options flow** — hours to days before price move
3. **DoD/SAM.gov contract awards** — often missed for weeks in micro/small-cap
4. **Form 4 insider buying** — well-known but still underweighted in small-cap
5. **SEC 8-K filings** — same-day but often misread by algos
6. **Earnings transcript tone shifts** — requires Gemini large-doc analysis to catch
7. **News / social sentiment** — shortest half-life, useful only for timing not discovery

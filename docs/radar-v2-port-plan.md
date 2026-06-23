---
title: Radar V2 — Source Location Verdict & Port Plan into engine/
date: 2026-06-23
status: recon complete (READ-ONLY pass — no code modified)
audience: any model/agent executing M4/M5 of the Asymmetry roadmap
---

# Radar V2 → `engine/` Port Plan

## TL;DR (verdict)

**FOUND.** The Radar V2 28-signal Python engine exists in two synced places:

- **GitHub:** `github.com/Maple-maker/No-Fomo` at path **`NoFomo/backend/radar_v2/`**
  (the repo root holds an iOS app named `NoFomo/`; the Python lives one level *inside* it).
- **Local:** `/Users/jaidenrabatin/Desktop/AEGIS/30-PROJECTS/active/No-Fomo/NoFomo/backend/radar_v2/`
  (also a mirror copy under `.../No-Fomo/.mirror/hermes-knowledge/...` and an inbox copy under
  `AEGIS/00-INBOX/REVIEW/No-Fomo/` — use the `30-PROJECTS/active` copy as the source of truth).

**Why the roadmap's 404 happened:** the roadmap assumed `backend/radar_v2/` at the repo root. The
real path nests the backend *inside* the iOS app folder: `NoFomo/backend/radar_v2/`. `gh api
repos/Maple-maker/No-Fomo/contents/backend` 404s; `.../contents/NoFomo/backend/radar_v2` resolves.

**State of the build:** this is a **partial implementation against a complete spec.** The schema,
scoring engine, two free adapters, and run_scan orchestrator are real and tested (R1 + most of R2).
The backtest harness is **stubs only** (R3 unbuilt), 26 of the 28 catalogued adapters are **not yet
written**, and the AI-council integration (R4) is unbuilt. The full design lives in a 478-line spec:
`No-Fomo/RADAR_V2_SIGNAL_ENGINE_SPEC.md`.

---

## Inventory — what actually exists in `radar_v2/`

Source root (local): `…/No-Fomo/NoFomo/backend/radar_v2/`

| File | LOC | Purpose | Status | Signals / category | Feed (free/keyed) |
|---|---|---|---|---|---|
| `signals/schema.py` | 70 | `Signal` frozen dataclass + `validate()` + `dedupe_key` + `to_dict()`. 8 `CATEGORIES` const. **The contract every adapter emits.** | ✅ done | n/a (shared schema) | n/a |
| `signals/adapters/sec_8k.py` | 104 | Wraps legacy `sec_scanner.py`; maps 8-K item → category; emits `sec_8k_material`. | ✅ done | GOV / COMMERCIAL / FUNDAMENTALS | **free** (SEC EDGAR) |
| `signals/adapters/form4_insider.py` | 114 | Wraps legacy `insider_scraper.py`; cluster-buy (≥2 insiders) + unplanned-sale. Emits `insider_cluster_buy`, `insider_sale_unplanned`. | ✅ done | INSIDER_SMART_MONEY | **free** (SEC Form 4) |
| `engine/score.py` | 107 | The deterministic core: `signal_score` (exp decay), `category_score` (saturating sum), `confluence_multiplier`, `score_ticker` → full ledger + **`gate_pass = radar_score >= 75`**. | ✅ done | all 8 (weights table) | n/a |
| `engine/crowding.py` | 3 | `crowding_value(news_z, social_z, move_z)` → [0,1] penalty input. | ✅ done (minimal) | crowding penalty | n/a |
| `engine/regime.py` | 21 | `vix_regime_flag` → CONTEXT_REGIME Signal (weight 0.0, flags only). | ✅ done | CONTEXT_REGIME | free (FRED VIX) |
| `engine/reprice.py` | 14 | `compute_reprice_gap` — reads a drift-curve dict, returns expected-drift/window-elapsed. **Consumes curves it has no producer for.** | ⚠️ stub-dependent | reprice metric | n/a (needs R3) |
| `run_scan.py` | 56 | Orchestrator: runs adapters → `score_ticker` per ticker → returns results. CLI `--tickers --days --dry-run`. **No Supabase write yet** (dry-run only). | ⚠️ partial (no DB write) | pipeline | n/a |
| `backtest/loader.py` | 12 | Point-in-time price loader. | ❌ stub | backtest | (intended Polygon — **have key**) |
| `backtest/event_study.py` | 28 | Abnormal-return event study. | ❌ stub | backtest | n/a |
| `backtest/drift_curves.py` | 10 | Per-signal drift-curve builder (feeds `reprice.py`). | ❌ stub | backtest | n/a |
| `backtest/costs.py` | 6 | Liquidity-bucket spread haircut. | ❌ stub | backtest | n/a |
| `backtest/report.py` | 14 | Honesty-guarded report generator. | ❌ stub | backtest | n/a |
| `tests/test_schema_adapters.py` | — | Schema validation + adapter idempotency. | ✅ present | — | — |
| `tests/test_score.py` | — | Decay / saturation / confluence / gate. | ✅ present | — | — |
| `tests/test_backtest_reprice_run_scan.py` | — | Backtest + reprice + run_scan. | ✅ present | — | — |

### Legacy scrapers the adapters wrap (sibling dir `…/backend/`, NOT under `radar_v2/`)

These are the real network code; the radar_v2 adapters are thin wrappers over them. **All free:**

| File | Source | Cost | Feeds adapter |
|---|---|---|---|
| `sec_scanner.py` (244) | SEC EDGAR `data.sec.gov/submissions` | **free, no key** | `sec_8k.py` |
| `insider_scraper.py` (334) | SEC Form 4 via EDGAR | **free, no key** | `form4_insider.py` |
| `macro_scraper.py` (204) | World Bank / IMF / DBnomics | **free, no key** | (regime context — not yet wired into radar_v2) |
| `stock_data.py` (166) | yfinance (RSI/MACD/valuation) | **free, unofficial** | (intended PRICE_VOLUME adapters — not built) |
| `earnings_scraper.py` (125) | yfinance earnings dates | **free** | (intended FUNDAMENTALS adapter — not built) |
| `valuation.py` (304), `screener.py` (377), `discover.py` (613), `backtest.py` (333) | mixed | mostly free | legacy V1 radar (pre-unification) |

> There is **also** a parallel TypeScript signal stack under `No-Fomo/NoFomo/server/src/lib/` (~30
> files: `dcfValuation.ts`, `optionsSignals.ts`, `buybackAnalysis.ts`, `analystRevisions.ts`,
> `shortReports.ts`, `edgarScout.ts`, `secAnalysis.ts`, etc.) plus `radarV2Shadow.ts`. This is the
> *old* per-lane radar the spec says to replace, kept running in shadow. **Do not port the TS lib**
> — it is the thing radar_v2 supersedes. It is useful only as a reference for signal heuristics.

---

## The 28-signal catalog — exists vs. must-build

Source of truth: `RADAR_V2_SIGNAL_ENGINE_SPEC.md` §3. The 8 categories (from `schema.py`):
`INSIDER_SMART_MONEY`, `GOVERNMENT_REGULATORY`, `COMMERCIAL_DEALS`, `FUNDAMENTALS_INFLECTION`,
`STREET_POSITIONING`, `PRICE_VOLUME_STRUCTURE`, `NARRATIVE_SENTIMENT`, `CONTEXT_REGIME`.

| signal_type | Category | Source | Cost tier | Built? |
|---|---|---|---|---|
| `sec_8k_material` | varies | SEC EDGAR | **free (M4)** | ✅ |
| `insider_cluster_buy` | INSIDER | EDGAR Form 4 | **free (M4)** | ✅ |
| `insider_sale_unplanned` | INSIDER (bear) | EDGAR Form 4 | **free (M4)** | ✅ |
| `vix_regime` / `fed_event` / `macro_regime` | CONTEXT | FRED + macro_scraper | **free (M4)** | ⚠️ VIX flag only; fed/macro not wired |
| `buyback_announce` | INSIDER | 8-K / press | **free (M4)** | ❌ |
| `f13_elite_add` | INSIDER | EDGAR 13F | **free (M4)** | ❌ |
| `activist_stake` | INSIDER | 13D/13G | **free (M4)** | ❌ |
| `gov_contract_award` | GOVERNMENT | USAspending / SAM.gov (**have SAM key**) | **free (M4)** | ❌ |
| `fda_decision` / `fda_designation` | GOVERNMENT | openFDA + ClinicalTrials.gov | **free (M4)** | ❌ |
| `partnership_deal` | COMMERCIAL | 8-K + Finnhub + Exa (**have Exa key**) | mixed | ❌ |
| `supply_chain_flow` | COMMERCIAL | supply_chain_mapper (server-side TS today) | built-elsewhere | ❌ (needs port/wrap) |
| `short_interest_shift` | STREET | FINRA bi-monthly | **free (M4)** | ❌ |
| `momentum_12_1` | PRICE_VOL | Polygon (**have key**) | free-ish (M4) | ❌ |
| `volume_anomaly` | PRICE_VOL | Polygon (**have key**) | free-ish (M4) | ❌ |
| `index_inclusion` | STREET | S&P/Russell announcements | **free (M4)** | ❌ |
| `spinoff_separation` | FUNDAMENTALS | 8-K / Form 10 | **free (M4)** | ❌ |
| `news_velocity` | NARRATIVE | Finnhub + RSS | mixed | ❌ |
| `social_buzz` | NARRATIVE | Stocktwits/Reddit (stub) | cheap | ❌ |
| `earnings_surprise` | FUNDAMENTALS | **FMP** | **keyed (M5) — NO KEY HELD** | ❌ |
| `guidance_change` | FUNDAMENTALS | FMP / 8-K | **keyed (M5)** | ❌ |
| `revenue_inflection` | FUNDAMENTALS | FMP | **keyed (M5)** | ❌ |
| `estimate_revision` | STREET | FMP estimates | **keyed (M5)** | ❌ |
| `analyst_action` | STREET | FMP / Finnhub | **keyed (M5) — NO KEY HELD** | ❌ |
| `coverage_initiation` | STREET | FMP | **keyed (M5)** | ❌ |
| `valuation_gap` | PRICE_VOL | computed (FMP + Polygon) | **keyed (M5)** | ❌ |
| `overreaction_reversal` | PRICE_VOL | computed + LLM classify (spec §3.1) | mixed (M5) | ❌ |

**Score:** ~3.5 of ~26 signal_types implemented (sec_8k, both Form 4 flavors, partial VIX flag).
Everything else is spec-only.

### Key-holding reality check (from `No-Fomo/.env.example`)
- **Held:** Polygon, SAM.gov, Exa, Tavily, Brave, Anthropic, Gemini, DeepSeek, Grok, Supabase
  (url + anon + service-role).
- **NOT held:** **FMP** and **Finnhub** — the two keyed feeds the roadmap flags. This **confirms the
  roadmap's open question**: M5 fundamentals/analyst/short-interest coverage is blocked until those
  keys land. Everything that lights up in **M4 is free-source** and unblocked today.

---

## Gap analysis: M4 (free) vs M5 (keyed)

**M4 — ship with what's free + keys already held (unblocked now):**
- Already done: schema, score engine, gate, `sec_8k`, `form4_insider`, VIX flag.
- Buildable free-source adapters: `usaspending`/`gov_contract_award` (have SAM key),
  `f13_flows`, `activist_stake`, `buybacks`, `short_interest` (FINRA), `momentum_12_1` +
  `volume_anomaly` (have Polygon), `index_inclusion`, `spinoff`, `openfda`/`fda_*`,
  `news_velocity` (RSS) + `social_stub`, macro/fed regime flags.
- The **≥75 gate already runs before any AI call** (`score_ticker` returns `gate_pass`) — the M4 DoD
  ("gate filters before AI") is structurally satisfied by the existing engine.

**M5 — blocked on keys + unbuilt depth:**
- All FMP/Finnhub adapters (`earnings_surprise`, `guidance_change`, `revenue_inflection`,
  `estimate_revision`, `analyst_action`, `coverage_initiation`, `valuation_gap`,
  `overreaction_reversal`). **Acquire FMP + Finnhub keys first.**
- **Backtest harness (R3)** — `loader/event_study/drift_curves/costs/report` are stubs; the live
  `reprice.py` reads drift curves nothing produces. Reprice Gap cannot ship until R3 is built and
  run against Polygon history (roadmap compliance rule #6: no backtest number ships unless the
  harness produced it).
- **AI Council (R4)** — researcher-not-voter integration + Supabase write of `council_explanation`
  is unbuilt in radar_v2 (lives only in the legacy TS server `src/agents/`).

---

## Port plan into `~/Projects/Asymmetry/engine/`

**Note:** `~/Projects/Asymmetry/engine/` **does not exist yet** (M0 hasn't run). `supabase/migrations/`
is empty (no `0001_init.sql` yet). This port is the substance of roadmap M0→M4→M5.

### Proposed directory layout (mirror the proven structure)
```
engine/                          # new Python home (roadmap M0 creates this)
  pyproject.toml / requirements.txt   # yfinance, pandas, requests, beautifulsoup4 (+ polygon, supabase)
  radar_v2/
    __init__.py
    signals/
      schema.py                  # PORT VERBATIM — the contract
      adapters/
        sec_8k.py                # PORT (+ port its legacy sec_scanner.py dep)
        form4_insider.py         # PORT (+ port its legacy insider_scraper.py dep)
        usaspending.py           # BUILD (free, have SAM key)
        f13_flows.py             # BUILD (free)
        short_interest.py        # BUILD (free FINRA)
        momentum.py              # BUILD (Polygon — have key)
        volume_anomaly.py        # BUILD (Polygon)
        openfda.py               # BUILD (free)
        news_rss.py / social_stub.py  # BUILD (free/cheap)
        buybacks.py spinoffs.py index_events.py activist.py  # BUILD (free)
        fmp_earnings.py fmp_estimates.py analyst_actions.py   # M5 (need FMP/Finnhub)
        valuation_gap.py overreaction.py                      # M5 (computed/keyed)
        supply_chain.py          # M5 (wrap/port from TS mapper)
    engine/
      score.py crowding.py regime.py reprice.py   # PORT VERBATIM (4 files)
    backtest/
      loader.py event_study.py drift_curves.py costs.py report.py  # BUILD (R3, Polygon)
    legacy/                      # the wrapped scrapers the adapters import
      sec_scanner.py insider_scraper.py macro_scraper.py stock_data.py
    run_scan.py                  # PORT + ADD Supabase write (replace dry-run-only)
    supabase_writer.py           # BUILD — the write contract below
    tests/                       # PORT all three test modules
```

### Order to port (free-source adapters → scoring → gate → Supabase writes)
1. **M0 scaffold:** create `engine/`, copy `requirements.txt`, get `pytest` green on the ported tests.
2. **Port verbatim (zero logic change):** `signals/schema.py`, `engine/{score,crowding,regime,reprice}.py`,
   the two adapters + their two legacy scrapers, the three test modules. Fix the package import root
   (currently `from radar_v2…`; keep that, or rename to `engine.radar_v2`).
3. **Wire the Supabase writer** (below) into `run_scan.py` so a scored ticker actually persists —
   gated on `gate_pass` (≥75) before any AI call (already computed).
4. **M4 free adapters** in catalog order: `usaspending` → `short_interest` → `f13_flows` →
   `momentum`/`volume_anomaly` (Polygon) → `openfda` → `buybacks`/`spinoffs`/`index_events`/`activist`
   → `news_rss`/`social_stub` → macro/fed regime flags. Each: one file, idempotent, returns `[]` on
   network error, emits valid `Signal`s, unit-tested.
5. **M5 (after FMP + Finnhub keys land):** FMP/Finnhub adapters, `valuation_gap`, `overreaction`,
   `supply_chain`, then **build the R3 backtest harness** and feed real drift curves into
   `reprice.py`, then **R4 AI-council** + `council_explanation` write.

### Supabase write contract (the integration seam)
Engine writes; the TS rubric reads. No synchronous TS↔Python call. Two tables (roadmap §Schema):

**`radar_opportunities`** (shared feed, no `user_id`; service-role write, auth read):
| column | source in `score_ticker()` output |
|---|---|
| `ticker` | `result["ticker"]` |
| `radar_score` | `result["radar_score"]` (0–100 int) |
| `reprice_gap` (jsonb) | `result["reprice_gap"]` (M5; null until R3) |
| `top_signals` (jsonb) | `result["signals"]` ledger (type/evidence/decayed_score/age/source_url) |
| `as_of` | scan timestamp; `unique(ticker, as_of)` |
| `score_breakdown` (jsonb) | `category_scores` + `confluence` + `crowding` (the §4.6 object) |
| `regime_flags` (text[]) | `result["regime_flags"]` |
| `council_explanation` (jsonb) | from R4 council (M5; null until R4) |

> The No-Fomo migration that adds the jsonb columns is `supabase_radar_v2_migration.sql` (adds
> `score_breakdown`, `reprice_gap`, `council_explanation`, `regime_flags` + GIN indexes). **Port these
> column adds into Asymmetry's `0001_init.sql`** — but note the roadmap's column names differ slightly
> (`top_signals` vs `score_breakdown`); reconcile to the roadmap's schema as the authority.

**`holding_snapshots`** (per-user, append-only; RLS user-owned):
`holding_id, user_id, ticker, snapshot_date, radar_score, score_delta, reprice_gap, top_signals jsonb`.
Engine writes a snapshot row per user-held ticker each scan; `score_delta` = today − prior snapshot.

---

## Blockers / open questions for the human

1. **FMP + Finnhub keys are NOT in the No-Fomo env** — confirmed absent. This gates all of M5
   (fundamentals, estimates, analyst actions, short interest depth, valuation gap). Acquire both, or
   accept M4 (free-source) as the beta ceiling. **This answers roadmap open-item #1.**
2. **Backtest harness is stubs** (R3 unbuilt). Reprice Gap depends on drift curves the engine cannot
   produce yet. Per compliance rule #6, **Reprice Gap cannot ship until R3 is built and run against
   Polygon history** (Polygon key is held). Decide: build R3 for beta, or ship M4 without Reprice Gap.
3. **AI Council (R4) lives only in the legacy TS server**, not in radar_v2. Asymmetry's roadmap wants
   the council reading the signal ledger as "researcher, not voter." Decide whether to port the
   council to Python in `engine/` or keep it in the TS server reading `radar_opportunities` from
   Supabase (the roadmap's "integration seam = Supabase" implies the latter is fine).
4. **`supply_chain_mapper.py` does not exist as Python** — the roadmap/spec name it, but in No-Fomo
   supply-chain logic lives in TS (`server/src/routes/supply-chain.ts`). Either port it to a Python
   adapter or have the TS side write that signal to Supabase directly.
5. **Polygon tier / delisted-ticker coverage** — the backtest honesty guards (spec §6.2) require a
   survivorship-bias banner if the Polygon tier lacks delisted tickers. Confirm the Polygon plan
   before publishing any "historical edge" stat.
6. **Package import root** — existing code imports `from radar_v2.…`. When it moves under `engine/`,
   either keep `radar_v2` as the top-level package name or update imports to `engine.radar_v2.…`;
   the ported tests assume `radar_v2`.
7. **Schema column naming drift** — No-Fomo's `radar_opportunities` uses `score_breakdown`; the
   Asymmetry roadmap lists `top_signals`. Pick one (roadmap is authority) before writing
   `0001_init.sql` so the Python writer and TS reader agree.

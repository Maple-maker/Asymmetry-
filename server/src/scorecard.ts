// src/scorecard.ts
//
// M3 — the server-side scorecard RUNNER. This is the thin orchestration layer that
// drives the M1 rubric engine (in `../lib/rubric/`) over a single linked holding and
// shapes the result into a row ready to upsert into the `holding_scorecards` table.
//
// It does NOT re-implement any rubric math — it only wires the engine's exported
// functions together in the order the roadmap prescribes:
//
//   resolveIndustry -> composeRubric -> deriveAutoScores -> mergeScores
//     -> computeWeightedTotal -> decideAction -> computeDeploy
//
// COMPLIANCE (non-negotiable, from docs/ASYMMETRY-RELEASE-ROADMAP.md):
//   * Read-only: this code NEVER places or modifies an order. It produces analysis only.
//   * Educational, not advice: the scorecard total + action tier are illustrative; the
//     `deploy` block is *sizing guidance*, never an order instruction.
//   * Composed weights must sum to 100 (±0.01) or composeRubric throws — we let it throw
//     (compliance constraint #9: no silent renormalization).
//
// Import surface: everything comes from the rubric barrel so we use the REAL exported
// signatures. NodeNext module resolution means runtime imports carry a `.js` suffix even
// though the source is `.ts` (the engine's own files do the same).

import {
  resolveIndustry,
  composeRubric,
  deriveAutoScores,
  mergeScores,
  computeWeightedTotal,
  decideAction,
  computeDeploy,
  RUBRIC_BASE,
  BASE_SEED_SCORES,
  AEROSPACE_DEFENSE_OVERLAY,
  AEROSPACE_DEFENSE_SEED_SCORES,
  type IndustryOverlay,
  type IndustryKey,
  type Fundamentals,
  type RubricAction,
  type DeployResult,
} from "../lib/rubric/index.js";

import { isSupabaseConfigured, getServiceClient } from "./supabase.js";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/**
 * The slice of a `holdings` row the scorecard runner needs. Mirrors the columns in
 * supabase/migrations/0001_init.sql (`holdings` table). Quantity / cost_basis /
 * market_value are nullable in SnapTrade feeds, so they are optional here.
 *
 * `id` is the holding_id FK; `userId` is the row owner — both flow straight onto the
 * output row so the upsert is RLS-correct.
 */
export interface Holding {
  id: string;          // holdings.id  -> holding_scorecards.holding_id
  userId: string;      // holdings.user_id
  ticker: string;      // holdings.ticker
  quantity?: number | null;
  costBasis?: number | null;
  marketValue?: number | null;
}

/**
 * Live market data the runner feeds into the engine. This shape is the contract M2 /
 * the feeds layer must match (see "ASSUMPTIONS" at the bottom of this file).
 *
 *  - `price`         : latest price (required — valuation + deploy need it).
 *  - `high52`/`low52`: 52-week high/low; null when the feed omits them (engine is null-safe).
 *  - `fundamentals`  : the engine's `Fundamentals` shape (margins/growth/FCF/leverage/etc.).
 *  - `budget`        : the per-holding deploy budget (sizing guidance base $). Defaults to 0,
 *                      which yields a $0 deploy amount — safe + advice-free when unset.
 *  - `portfolioTotal`: total portfolio market value, for the concentration cap. Defaults to 0.
 */
export interface MarketData {
  price: number;
  high52: number | null;
  low52: number | null;
  fundamentals: Fundamentals;
  budget?: number;
  portfolioTotal?: number;
}

// ---------------------------------------------------------------------------
// Output shape — EXACTLY the `holding_scorecards` columns
// ---------------------------------------------------------------------------

/**
 * One row shaped for the `holding_scorecards` table (supabase/migrations/0001_init.sql).
 * Column names are snake_case to match Postgres / the Supabase client's expectations on
 * insert. `id`, `score_date` (default current_date) and `created_at` (default now()) are
 * filled by the DB, so they're intentionally omitted here.
 *
 * `category_scores` and `deploy` are JSON (jsonb columns). `total_delta` is null on a
 * first run (no prior scorecard to diff against) — the persistence helper computes it.
 */
export interface ScorecardRow {
  holding_id: string;
  user_id: string;
  ticker: string;
  industry_key: IndustryKey | null;
  total: number;
  total_delta: number | null;
  action: RubricAction;
  category_scores: Record<string, number>;
  deploy: DeployResult;
}

// ---------------------------------------------------------------------------
// Overlay lookup (industry key -> Layer-B overlay + its seed scores)
// ---------------------------------------------------------------------------

/**
 * The TS-side overlay registry. In production the overlays live in `rubric_industry`
 * (Layer B) and are read from Supabase; for M3 we mirror the one seeded overlay
 * (`aerospace_defense`) here so the runner works with no DB — exactly the no-op seam
 * pattern the engine itself uses (seed.ts is the TS mirror of the SQL seed).
 *
 * A key with no entry here (or a null industry) falls back to the BASE-ONLY path: an
 * empty overlay, so the 5-spine base fills all 100 (the Layer-C seam, pre-AI-draft).
 */
const OVERLAY_REGISTRY: Partial<Record<IndustryKey, IndustryOverlay>> = {
  aerospace_defense: AEROSPACE_DEFENSE_OVERLAY,
};

/** Per-industry seed (carry-forward fallback) scores for the overlay's judgment factors. */
const OVERLAY_SEED_REGISTRY: Partial<Record<IndustryKey, Record<string, number>>> = {
  aerospace_defense: AEROSPACE_DEFENSE_SEED_SCORES,
};

/**
 * An empty overlay — used for the base-only path (unknown / null industry). composeRubric
 * accepts an overlay summing to 0 and lets the base fill all 100 (a degenerate-but-valid
 * case the engine explicitly supports).
 */
function emptyOverlay(industryKey: string): IndustryOverlay {
  return { industryKey, origin: "authored", categories: [] };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/**
 * Score a single holding and return a row shaped for `holding_scorecards`.
 *
 * Pipeline (each step uses the engine's real exported function):
 *  1. resolveIndustry(industryLabel)  -> IndustryKey | null (null => base-only / Layer-C seam)
 *  2. composeRubric(base, overlay)    -> composed rubric (throws if it can't sum to 100)
 *  3. deriveAutoScores(...)           -> auto/partial scores from price/52wk/fundamentals
 *  4. mergeScores(rubric, saved, ...) -> final 0..10 score per category (saved=null on 1st run -> seeds)
 *  5. computeWeightedTotal(...)       -> 0..100 total
 *  6. decideAction(total)             -> action tier (aggressive/normal/small/pause)
 *  7. computeDeploy(...)              -> sizing guidance block (NOT an order)
 *
 * @param holding       the holding to score (id / userId / ticker + optional position fields)
 * @param marketData    live price + 52wk + fundamentals (the M2/feeds contract)
 * @param industryLabel raw provider industry label (e.g. Finnhub `finnhubIndustry`), or null
 * @param savedScores   the user's last saved judgment scores, or null on the first run
 * @returns a ScorecardRow ready to upsert (total_delta left null — set by persistScorecard)
 */
export function scoreHolding(
  holding: Holding,
  marketData: MarketData,
  industryLabel: string | null | undefined,
  savedScores: Record<string, number> | null = null
): ScorecardRow {
  // 1. Resolve the provider's industry label onto a curated key (null => Layer-C seam).
  const industryKey = resolveIndustry(industryLabel);

  // 2. Pick the overlay + its seed scores for this key (base-only when none is registered).
  const overlay = industryKey
    ? OVERLAY_REGISTRY[industryKey] ?? emptyOverlay(industryKey)
    : emptyOverlay("base_only");
  const overlaySeed = industryKey ? OVERLAY_SEED_REGISTRY[industryKey] ?? {} : {};

  // Compose Layer A (base spine) + Layer B (overlay). Lets composeRubric THROW if the
  // weights can't sum to 100 (±0.01) — compliance constraint #9, no silent renormalization.
  const rubric = composeRubric(RUBRIC_BASE, overlay);

  // 3. Derive the auto/partial category scores from live data.
  const auto = deriveAutoScores({
    price: marketData.price,
    high52: marketData.high52,
    low52: marketData.low52,
    fundamentals: marketData.fundamentals,
  });

  // 4. Merge: auto/partial categories take the live value; judgment categories carry the
  //    saved value or fall back to the seed. Seeds = base spine seeds + this overlay's seeds.
  const seed: Record<string, number> = { ...BASE_SEED_SCORES, ...overlaySeed };
  const categoryScores = mergeScores(rubric, savedScores, auto, seed);

  // 5. Weighted 0..100 total over the composed rubric.
  const total = computeWeightedTotal(rubric, categoryScores);

  // 6. Action tier from the total (>=85 / >=75 / >=65 boundaries).
  const action = decideAction(total);

  // 7. Sizing guidance (NOT an order). budget/portfolioTotal default to 0 => $0 deploy,
  //    which is the safe, advice-free default when the caller hasn't supplied them.
  const positionValue = holding.marketValue ?? 0;
  const deploy = computeDeploy({
    total,
    budget: marketData.budget ?? 0,
    price: marketData.price,
    high52: marketData.high52,
    positionValue,
    portfolioTotal: marketData.portfolioTotal ?? 0,
  });

  return {
    holding_id: holding.id,
    user_id: holding.userId,
    ticker: holding.ticker,
    industry_key: industryKey,
    total,
    total_delta: null, // first-run default; persistScorecard fills it if a prior row exists
    action,
    category_scores: categoryScores,
    deploy,
  };
}

// ---------------------------------------------------------------------------
// Persistence (thin DB seam — no live DB required)
// ---------------------------------------------------------------------------

/**
 * Persist a scorecard row to `holding_scorecards` IF Supabase credentials are present,
 * otherwise no-op and just return the row. This mirrors the engine/agent DB seam
 * (`isSupabaseConfigured()` gate over the lazy service client) so the runner — and its
 * tests — work with no live database.
 *
 * `holding_scorecards` is APPEND-ONLY (insert, never update), so we INSERT a fresh row
 * each run. Before inserting we look up the most recent prior total for this holding to
 * fill `total_delta` (today's total minus the last one); null when there's no prior row.
 *
 * NOTE on `industry_key`: the column has a FK to `rubric_industry(industry_key)`. A
 * resolved key that has no overlay row yet would violate that FK, so on the base-only /
 * unseeded path the runner already carried `industry_key = null` through, which is valid.
 *
 * @param row a ScorecardRow from scoreHolding
 * @returns { persisted: boolean; row } — `persisted:false` means the no-DB no-op path ran
 */
export async function persistScorecard(
  row: ScorecardRow
): Promise<{ persisted: boolean; row: ScorecardRow }> {
  // No-op seam: no creds => return the row untouched (used in tests + before DB is wired).
  if (!isSupabaseConfigured()) {
    return { persisted: false, row };
  }

  const db = getServiceClient();

  // Compute total_delta vs. the most recent prior scorecard for this holding (append-only
  // table => "latest" = highest score_date / created_at).
  const { data: prior } = await db
    .from("holding_scorecards")
    .select("total")
    .eq("holding_id", row.holding_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const priorTotal =
    prior && typeof prior.total === "number" ? prior.total : null;
  const rowToInsert: ScorecardRow = {
    ...row,
    total_delta:
      priorTotal == null ? null : Math.round((row.total - priorTotal) * 100) / 100,
  };

  const { error } = await db.from("holding_scorecards").insert(rowToInsert);
  if (error) {
    throw new Error(`Failed to persist scorecard for ${row.ticker}: ${error.message}`);
  }

  return { persisted: true, row: rowToInsert };
}

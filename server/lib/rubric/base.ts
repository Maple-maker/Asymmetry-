// lib/rubric/base.ts
//
// Net-new for Asymmetry. Layer A — the universal 5-spine base, present in EVERY composed
// rubric. spcx had no such universal spine (it was all SpaceX-specific factors), so this
// is authored fresh from the rubric-engine-spec's Layer-A table.
//
// IMPORTANT: these weights are *starting* (relative) weights. composeRubric scales them
// proportionally to fill whatever the industry overlay leaves of 100 (the base-fill
// rule). Only the relative proportions here matter — the absolute total is re-derived at
// compose time. We author them to sum to 100 purely for readability.
import type { RubricBaseRow } from "./types.js";

/**
 * The 5 universal spine categories (spec Layer-A table):
 *  - valuation  (auto)     — 52-wk range position
 *  - financial  (auto)     — margins / growth / FCF / leverage rubric
 *  - liquidity  (partial)  — float / short interest; neutral until data lands
 *  - execution  (judgment) — management track record
 *  - moat       (judgment) — competitive position / durable advantage
 *
 * Relative emphasis: the two auto fundamentals (valuation, financial) carry the most
 * weight, then moat, then execution, with liquidity the lightest (it's only a partial
 * signal today). These proportions are what the base-fill rule preserves.
 */
export const RUBRIC_BASE: RubricBaseRow[] = [
  { key: "valuation", label: "Valuation / market structure",      weight: 25, sourceClass: "auto",     derivation: "valuation_range_pos" },
  { key: "financial", label: "Financial strength",                weight: 25, sourceClass: "auto",     derivation: "financial_rubric" },
  { key: "liquidity", label: "Liquidity / float / short interest", weight: 10, sourceClass: "partial",  derivation: "short_interest_neutral" },
  { key: "execution", label: "Execution / management track record", weight: 15, sourceClass: "judgment", derivation: null },
  { key: "moat",      label: "Competitive position / moat",        weight: 25, sourceClass: "judgment", derivation: null },
];

/**
 * Neutral seed scores for the spine (0..10), used as the carry-forward fallback in
 * mergeScores when there's no saved judgment value and no derived auto value. 5 = neutral.
 */
export const BASE_SEED_SCORES: Record<string, number> = {
  valuation: 5,
  financial: 5,
  liquidity: 5,
  execution: 5,
  moat: 5,
};

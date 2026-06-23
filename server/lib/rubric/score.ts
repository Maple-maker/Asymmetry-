// lib/rubric/score.ts
//
// Ported from MarketPulse `lib/spcx/score.ts`. The ONLY change vs. the spcx original:
// it iterates the *composed* rubric's categories (passed in) instead of the hardwired
// SpaceX `CATEGORIES` const — exactly as the rubric-engine-spec pseudocode prescribes.
// The math is identical.
import type { Rubric } from "./types.js";

/**
 * Weighted total of a scored rubric.
 * Each category contributes (score/10) * weight; weights sum to 100, so a perfect
 * all-10 scorecard totals exactly 100. Rounded to 2 decimals (same as spcx).
 *
 * @param rubric a composed rubric (weights summing to 100 — guaranteed by composeRubric)
 * @param scores 0..10 score per category key
 */
export function computeWeightedTotal(
  rubric: Rubric,
  scores: Record<string, number>
): number {
  const total = rubric.categories.reduce(
    (sum, c) => sum + (scores[c.key] / 10) * c.weight,
    0
  );
  return Math.round(total * 100) / 100;
}

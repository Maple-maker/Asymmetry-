// lib/rubric/compose.ts
//
// Net-new for Asymmetry. Implements the LOCKED base-fill rule from the rubric-engine-spec.
// spcx had no composition step (its single hardwired CATEGORIES list already summed to 100).
//
// THE RULE (LOCKED 2026-06-23):
//   1. The industry overlay carries authored weights that sum to < 100.
//   2. composeRubric scales the Layer-A base PROPORTIONALLY to fill `100 - overlaySum`,
//      preserving the base's relative proportions. The base is the adjustable cushion;
//      the overlay is authored truth and is NEVER renormalized.
//   3. The final composed rubric MUST sum to 100 (±0.01) or composeRubric THROWS.
//      No silent renormalization (compliance constraint #9).
import type { IndustryOverlay, Rubric, RubricBaseRow, RubricCategory } from "./types.js";

/** ±0.01 rounding tolerance on the sum-to-100 invariant (from the spec). */
const TOLERANCE = 0.01;

function sumWeights(cats: { weight: number }[]): number {
  return cats.reduce((s, c) => s + c.weight, 0);
}

/**
 * Compose Layer A (base) + Layer B (industry overlay) into a single rubric summing to 100.
 *
 * @param baseRows the 5-spine base (starting/relative weights — see base.ts)
 * @param overlay  the industry overlay; its category weights must sum to < 100
 * @returns a Rubric whose category weights sum to 100 (±0.01)
 * @throws if the overlay weights are >= 100 (no room for the spine) or negative, or if —
 *         as a final guard — the composed total drifts outside 100 ±0.01.
 */
export function composeRubric(
  baseRows: RubricBaseRow[],
  overlay: IndustryOverlay
): Rubric {
  const overlaySum = sumWeights(overlay.categories);

  // The overlay must leave room for the spine. >= 100 (or negative) is an authoring/AI bug.
  if (overlaySum < 0) {
    throw new Error(
      `Invalid overlay for "${overlay.industryKey}": weights sum to ${overlaySum} (must be >= 0).`
    );
  }
  // Must leave a non-zero remainder for the spine: reject anything not strictly < 100
  // (within tolerance). At exactly 100 the base would scale to 0, which the spec forbids
  // ("the spine is always present with a non-zero share").
  if (overlaySum > 100 - TOLERANCE) {
    throw new Error(
      `Invalid overlay for "${overlay.industryKey}": weights sum to ${overlaySum} (must be < 100 to leave room for the base spine).`
    );
  }

  const remainder = 100 - overlaySum; // what the base must fill
  const baseSum = sumWeights(baseRows);
  if (baseSum <= 0) {
    throw new Error("Invalid base: starting weights must sum to a positive number.");
  }

  // Scale each base row to fill the remainder while preserving relative proportions:
  // scaledWeight = b.weight / baseSum * remainder.
  const scaledBase: RubricCategory[] = baseRows.map((b) => ({
    key: b.key,
    label: b.label,
    weight: (b.weight / baseSum) * remainder,
    sourceClass: b.sourceClass,
  }));

  // base ++ overlay — overlay weights are passed through untouched (authored truth).
  const categories: RubricCategory[] = [...scaledBase, ...overlay.categories];

  // Final guard: the composed rubric MUST sum to 100 (±0.01) — else throw, never renormalize.
  const finalSum = sumWeights(categories);
  if (Math.abs(finalSum - 100) > TOLERANCE) {
    throw new Error(
      `Composed rubric for "${overlay.industryKey}" sums to ${finalSum}, not 100 (±${TOLERANCE}).`
    );
  }

  return { industryKey: overlay.industryKey, categories };
}

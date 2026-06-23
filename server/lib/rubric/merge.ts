// lib/rubric/merge.ts
//
// Ported from MarketPulse `lib/spcx/merge.ts`. Generalized so it merges over an
// arbitrary composed rubric (and an explicit seed map) instead of the SpaceX const.
// The carry-forward logic is byte-for-byte the same idea as spcx.
import type { Rubric } from "./types.js";

/**
 * Build the final per-category score map for a composed rubric by merging three sources:
 *  - auto / partial categories take the live-derived value when present;
 *  - judgment categories carry forward the user's last saved value;
 *  - anything still missing falls back to the seed (the model's starting value).
 *
 * AI draft scores are *hints* applied on click upstream — never passed in here as `auto`.
 *
 * @param rubric the composed rubric (defines categories + their source classes)
 * @param saved  the user's last saved judgment scores (or null on first run)
 * @param auto   freshly derived auto/partial scores (e.g. from deriveAutoScores)
 * @param seed   per-category fallback values (the model's working scores)
 */
export function mergeScores(
  rubric: Rubric,
  saved: Record<string, number> | null,
  auto: Record<string, number>,
  seed: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of rubric.categories) {
    const isAuto = c.sourceClass === "auto" || c.sourceClass === "partial";
    if (isAuto && auto[c.key] != null) {
      out[c.key] = auto[c.key];
    } else {
      out[c.key] = saved?.[c.key] ?? seed[c.key];
    }
  }
  return out;
}

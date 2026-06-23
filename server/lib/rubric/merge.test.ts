// lib/rubric/merge.test.ts — adapted from spcx. The generalized mergeScores takes the
// composed rubric + an explicit seed map. Same carry-forward behavior as spcx:
// auto/partial -> derived; judgment -> saved -> seed.
import { describe, it, expect } from "vitest";
import { mergeScores } from "./merge.js";
import { composeRubric } from "./compose.js";
import { RUBRIC_BASE, BASE_SEED_SCORES } from "./base.js";
import { AEROSPACE_DEFENSE_OVERLAY, AEROSPACE_DEFENSE_SEED_SCORES } from "./seed.js";

const rubric = composeRubric(RUBRIC_BASE, AEROSPACE_DEFENSE_OVERLAY);
const seed = { ...BASE_SEED_SCORES, ...AEROSPACE_DEFENSE_SEED_SCORES };

describe("mergeScores", () => {
  it("auto/partial keys take the derived value; judgment keys fall back to seed when unsaved", () => {
    const r = mergeScores(rubric, null, { valuation: 8, financial: 6, liquidity: 4 }, seed);
    expect(r.valuation).toBe(8); // auto
    expect(r.financial).toBe(6); // auto
    expect(r.liquidity).toBe(4); // partial
    // judgment -> seed (no saved value)
    expect(r.program_cadence).toBe(seed.program_cadence);
    expect(r.moat).toBe(seed.moat);
  });

  it("judgment keys carry forward the saved value", () => {
    const r = mergeScores(
      rubric,
      { program_cadence: 6, next_gen_platform: 4, moat: 7 },
      { valuation: 8, financial: 6, liquidity: 5 },
      seed
    );
    expect(r.program_cadence).toBe(6);
    expect(r.next_gen_platform).toBe(4);
    expect(r.moat).toBe(7);
  });

  it("auto key falls back to seed when no derived value is present", () => {
    const r = mergeScores(rubric, null, {}, seed);
    expect(r.valuation).toBe(seed.valuation);
  });
});

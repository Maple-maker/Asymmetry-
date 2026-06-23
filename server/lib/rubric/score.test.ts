// lib/rubric/score.test.ts — adapted from spcx. The generalized computeWeightedTotal
// takes a *composed* rubric, so we compose aerospace_defense first, then score it.
import { describe, it, expect } from "vitest";
import { computeWeightedTotal } from "./score.js";
import { composeRubric } from "./compose.js";
import { RUBRIC_BASE } from "./base.js";
import { AEROSPACE_DEFENSE_OVERLAY } from "./seed.js";

const rubric = composeRubric(RUBRIC_BASE, AEROSPACE_DEFENSE_OVERLAY);

describe("computeWeightedTotal", () => {
  it("max score is 100 when every category is 10", () => {
    const all10: Record<string, number> = {};
    for (const c of rubric.categories) all10[c.key] = 10;
    expect(computeWeightedTotal(rubric, all10)).toBe(100);
  });

  it("scoring everything 5 yields exactly half (50)", () => {
    const all5: Record<string, number> = {};
    for (const c of rubric.categories) all5[c.key] = 5;
    expect(computeWeightedTotal(rubric, all5)).toBe(50);
  });

  it("computes a known weighted total from mixed scores", () => {
    // Base scaled to fill 30: valuation 7.5, financial 7.5, liquidity 3.0,
    // execution 4.5, moat 7.5. Overlay: program_cadence 15, next_gen_platform 15,
    // recurring_revenue 15, government_moat 10, competitive_pos 10, optionality 5.
    // Score every category 8 -> total = 0.8 * 100 = 80.
    const all8: Record<string, number> = {};
    for (const c of rubric.categories) all8[c.key] = 8;
    expect(computeWeightedTotal(rubric, all8)).toBe(80);
  });
});

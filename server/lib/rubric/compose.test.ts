// lib/rubric/compose.test.ts — net-new. The heart of the engine: the base-fill rule and
// the sum-to-100-or-throw invariant (compliance constraint #9). Thorough coverage of:
// sum-to-100, throw when overlay >= 100, base scaling correctness, the degenerate empty
// overlay, and the ±0.01 tolerance.
import { describe, it, expect } from "vitest";
import { composeRubric } from "./compose.js";
import { RUBRIC_BASE } from "./base.js";
import { AEROSPACE_DEFENSE_OVERLAY } from "./seed.js";
import type { IndustryOverlay } from "./types.js";

function sum(cats: { weight: number }[]): number {
  return cats.reduce((s, c) => s + c.weight, 0);
}

// A simple base with clean proportions to make scaling math easy to assert:
// total 100, proportions 40/30/20/10.
const SIMPLE_BASE = [
  { key: "valuation", label: "Valuation", weight: 40, sourceClass: "auto" as const, derivation: null },
  { key: "financial", label: "Financial", weight: 30, sourceClass: "auto" as const, derivation: null },
  { key: "liquidity", label: "Liquidity", weight: 20, sourceClass: "partial" as const, derivation: null },
  { key: "moat", label: "Moat", weight: 10, sourceClass: "judgment" as const, derivation: null },
];

function overlayWithSum(total: number): IndustryOverlay {
  return {
    industryKey: "test",
    origin: "authored",
    categories: [{ key: "x", label: "X", weight: total, sourceClass: "judgment" }],
  };
}

describe("composeRubric — base-fill rule", () => {
  it("overlay summing to 60 -> composed total === 100, base scaled to fill 40", () => {
    const overlay = overlayWithSum(60);
    const r = composeRubric(SIMPLE_BASE, overlay);
    expect(sum(r.categories)).toBeCloseTo(100, 2);

    // base (proportions 40/30/20/10 of 100) scaled to fill 40 -> 16/12/8/4
    const byKey = Object.fromEntries(r.categories.map((c) => [c.key, c.weight]));
    expect(byKey.valuation).toBeCloseTo(16, 6);
    expect(byKey.financial).toBeCloseTo(12, 6);
    expect(byKey.liquidity).toBeCloseTo(8, 6);
    expect(byKey.moat).toBeCloseTo(4, 6);
    // overlay weight passed through untouched (authored truth — not renormalized)
    expect(byKey.x).toBe(60);
  });

  it("preserves the base's RELATIVE proportions after scaling", () => {
    const r = composeRubric(SIMPLE_BASE, overlayWithSum(70));
    const byKey = Object.fromEntries(r.categories.map((c) => [c.key, c.weight]));
    // ratio valuation:financial should stay 40:30 = 4:3
    expect(byKey.valuation / byKey.financial).toBeCloseTo(40 / 30, 6);
    // ratio liquidity:moat should stay 20:10 = 2:1
    expect(byKey.liquidity / byKey.moat).toBeCloseTo(2, 6);
  });

  it("overlay summing to exactly 0 -> base fills all 100 (degenerate but valid)", () => {
    const empty: IndustryOverlay = { industryKey: "none", origin: "authored", categories: [] };
    const r = composeRubric(SIMPLE_BASE, empty);
    expect(sum(r.categories)).toBeCloseTo(100, 2);
    // with empty overlay the base IS the rubric, unchanged proportions summing to 100
    const byKey = Object.fromEntries(r.categories.map((c) => [c.key, c.weight]));
    expect(byKey.valuation).toBeCloseTo(40, 6);
  });

  it("the seeded aerospace_defense overlay composes to exactly 100", () => {
    const r = composeRubric(RUBRIC_BASE, AEROSPACE_DEFENSE_OVERLAY);
    expect(sum(r.categories)).toBeCloseTo(100, 2);
    // 5 base + 6 overlay = 11 categories
    expect(r.categories).toHaveLength(11);
    expect(r.industryKey).toBe("aerospace_defense");
  });

  it("THROWS when overlay weights sum to >= 100 (no room for the spine)", () => {
    expect(() => composeRubric(SIMPLE_BASE, overlayWithSum(100))).toThrow(/leave room/);
    expect(() => composeRubric(SIMPLE_BASE, overlayWithSum(120))).toThrow();
  });

  it("THROWS on a negative overlay weight sum", () => {
    expect(() => composeRubric(SIMPLE_BASE, overlayWithSum(-5))).toThrow(/>= 0/);
  });

  it("accepts an overlay just under 100 within the ±0.01 tolerance (no throw)", () => {
    const r = composeRubric(SIMPLE_BASE, overlayWithSum(99.99));
    expect(sum(r.categories)).toBeCloseTo(100, 2);
  });
});

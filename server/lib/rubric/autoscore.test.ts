// lib/rubric/autoscore.test.ts — ported from spcx. Adapted only the `Fundamentals`
// import (now local to autoscore.ts instead of the Next.js `@/lib/providers/types`).
// The expected scores are identical to the spcx fixtures.
import { describe, it, expect } from "vitest";
import { deriveAutoScores, type Fundamentals } from "./autoscore.js";

const NULL_F: Fundamentals = {
  pe: null, eps: null, revenue: null, revenueGrowth: null, grossMargin: null,
  netMargin: null, debtToEquity: null, freeCashFlow: null, bookValue: null,
  dividendYield: null, beta: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
};

describe("deriveAutoScores", () => {
  it("scores valuation high near the 52wk low", () => {
    const r = deriveAutoScores({ price: 165, high52: 225.64, low52: 149.34, fundamentals: NULL_F });
    // rangePos = (165-149.34)/(225.64-149.34) ≈ 0.2053 -> 10 - 10*0.2053 ≈ 7.9
    expect(r.valuation).toBe(7.9);
  });
  it("financial rubric: strong gross margin but negative net margin nets ~5", () => {
    const f: Fundamentals = { ...NULL_F, grossMargin: 49.39, netMargin: -26.44, debtToEquity: 0.554 };
    const r = deriveAutoScores({ price: 165, high52: 225, low52: 149, fundamentals: f });
    expect(r.financial).toBe(5);
  });
  it("liquidity defaults to neutral 5 (short interest unavailable)", () => {
    const r = deriveAutoScores({ price: 165, high52: 225, low52: 149, fundamentals: NULL_F });
    expect(r.liquidity).toBe(5);
  });
  it("is null-safe: no 52wk range -> valuation omitted, financial still 5", () => {
    const r = deriveAutoScores({ price: 165, high52: null, low52: null, fundamentals: NULL_F });
    expect(r.valuation).toBeUndefined();
    expect(r.financial).toBe(5);
  });
});

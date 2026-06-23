// lib/rubric/base.test.ts — net-new. Sanity-checks the Layer-A universal spine.
import { describe, it, expect } from "vitest";
import { RUBRIC_BASE, BASE_SEED_SCORES } from "./base.js";

const EXPECTED_SPINE = ["valuation", "financial", "liquidity", "execution", "moat"];

describe("rubric base (Layer A spine)", () => {
  it("contains exactly the 5 universal spine keys", () => {
    expect(RUBRIC_BASE.map((b) => b.key).sort()).toEqual([...EXPECTED_SPINE].sort());
  });

  it("every base row has a valid source_class", () => {
    for (const b of RUBRIC_BASE) {
      expect(["auto", "partial", "judgment"]).toContain(b.sourceClass);
    }
  });

  it("auto/partial rows declare a derivation; judgment rows do not", () => {
    for (const b of RUBRIC_BASE) {
      if (b.sourceClass === "judgment") expect(b.derivation).toBeNull();
      else expect(typeof b.derivation).toBe("string");
    }
  });

  it("every spine key has a seed score", () => {
    for (const b of RUBRIC_BASE) expect(typeof BASE_SEED_SCORES[b.key]).toBe("number");
  });
});

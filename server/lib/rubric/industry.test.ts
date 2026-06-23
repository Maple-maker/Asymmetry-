// lib/rubric/industry.test.ts — net-new. Verifies the provider-label -> IndustryKey
// resolution across the curated taxonomy, plus the unknown -> null (Layer C) path.
import { describe, it, expect } from "vitest";
import { resolveIndustry, INDUSTRY_KEYS } from "./industry.js";

describe("resolveIndustry", () => {
  it("maps known Finnhub-style labels to curated keys", () => {
    expect(resolveIndustry("Aerospace & Defense")).toBe("aerospace_defense");
    expect(resolveIndustry("Semiconductors")).toBe("semiconductors");
    expect(resolveIndustry("Software")).toBe("software");
    expect(resolveIndustry("Technology")).toBe("software");
    expect(resolveIndustry("Banking")).toBe("banks");
    expect(resolveIndustry("Oil & Gas")).toBe("energy");
    expect(resolveIndustry("Biotechnology")).toBe("biotech");
    expect(resolveIndustry("Retail")).toBe("consumer_retail");
    expect(resolveIndustry("Utilities")).toBe("utilities");
    expect(resolveIndustry("Metals & Mining")).toBe("materials");
    expect(resolveIndustry("Telecommunication")).toBe("telecom");
    expect(resolveIndustry("REIT")).toBe("reits");
    expect(resolveIndustry("Airlines")).toBe("transport");
    expect(resolveIndustry("Media")).toBe("media_entertainment");
    expect(resolveIndustry("Automobiles")).toBe("auto_ev");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(resolveIndustry("  aEROSPACE  ")).toBe("aerospace_defense");
  });

  it("returns null for an unmapped industry (triggers Layer C)", () => {
    expect(resolveIndustry("Quantum Wizardry")).toBeNull();
  });

  it("returns null for empty / nullish input", () => {
    expect(resolveIndustry(null)).toBeNull();
    expect(resolveIndustry(undefined)).toBeNull();
    expect(resolveIndustry("")).toBeNull();
  });

  it("every resolved key is in the curated taxonomy", () => {
    const k = resolveIndustry("Semiconductors");
    expect(INDUSTRY_KEYS).toContain(k);
  });
});

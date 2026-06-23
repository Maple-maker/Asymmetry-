// lib/rubric/deploy.test.ts — ported verbatim from spcx. The deploy math must be
// unchanged from the spcx fixtures (DoD: "deploy.ts behavior unchanged from spcx fixtures").
import { describe, it, expect } from "vitest";
import { decideAction, computeDeploy } from "./deploy.js";

describe("decideAction", () => {
  it("maps totals to the model's action tiers", () => {
    expect(decideAction(90)).toBe("aggressive");
    expect(decideAction(78)).toBe("normal");
    expect(decideAction(70)).toBe("small");
    expect(decideAction(60)).toBe("pause");
    // tier boundaries are inclusive lower bounds (>=)
    expect(decideAction(85)).toBe("aggressive");
    expect(decideAction(84.99)).toBe("normal");
    expect(decideAction(75)).toBe("normal");
    expect(decideAction(74.99)).toBe("small");
    expect(decideAction(65)).toBe("small");
    expect(decideAction(64.99)).toBe("pause");
  });
});

describe("computeDeploy", () => {
  const base = { budget: 500, positionValue: 1000, portfolioTotal: 10000 };

  it("normal DCA: no price drop -> budget x base multiplier", () => {
    const r = computeDeploy({ total: 78, price: 220, high52: 225, ...base });
    expect(r.action).toBe("normal");
    expect(r.ruleFired).toBe("normal");
    expect(r.amount).toBe(500);
  });
  it("-15% off high boosts to 1.5x", () => {
    const r = computeDeploy({ total: 78, price: 190, high52: 225, ...base });
    expect(r.ruleFired).toBe("down15");
    expect(r.amount).toBe(750);
  });
  it("-25% off high boosts to 2x", () => {
    const r = computeDeploy({ total: 78, price: 165, high52: 225, ...base });
    expect(r.ruleFired).toBe("down25");
    expect(r.amount).toBe(1000);
  });
  it("score below 65 pauses -> deploy 0", () => {
    const r = computeDeploy({ total: 60, price: 165, high52: 225, ...base });
    expect(r.action).toBe("pause");
    expect(r.amount).toBe(0);
  });
  it("soft cap at >=25% concentration -> deploy 0", () => {
    const r = computeDeploy({ total: 78, price: 220, high52: 225, budget: 500, positionValue: 2600, portfolioTotal: 10000 });
    expect(r.capped).toBe("soft");
    expect(r.amount).toBe(0);
  });
  it("hard cap at >=30% concentration -> deploy 0", () => {
    const r = computeDeploy({ total: 78, price: 220, high52: 225, budget: 500, positionValue: 3100, portfolioTotal: 10000 });
    expect(r.capped).toBe("hard");
    expect(r.amount).toBe(0);
  });
  it("aggressive (>=85) with no drop uses 1.5x base", () => {
    const r = computeDeploy({ total: 86, price: 224, high52: 225, ...base });
    expect(r.action).toBe("aggressive");
    expect(r.amount).toBe(750);
  });
  it("no portfolio -> concentration 0, not capped", () => {
    const r = computeDeploy({ total: 78, price: 220, high52: 225, budget: 500, positionValue: 0, portfolioTotal: 0 });
    expect(r.concentration).toBe(0);
    expect(r.capped).toBe("none");
  });
});

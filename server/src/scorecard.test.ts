// src/scorecard.test.ts
//
// Tests for the M3 scorecard runner. These verify the runner WIRES the engine correctly
// — they do NOT re-test the engine math itself (that's covered by lib/rubric/*.test.ts).
//
// Coverage:
//   1. A holding with a known industry (aerospace_defense) -> a scorecard whose total
//      matches a HAND-COMPUTED expectation, with the correct action tier.
//   2. The composed rubric's weights sum to 100 (the sum-to-100 invariant, end to end).
//   3. The base-only path (null / unknown industry) works and is correctly shaped.
//   4. The row is shaped EXACTLY to the holding_scorecards columns.
//   5. persistScorecard no-ops (returns the row, persisted:false) with no DB configured.
import { describe, it, expect } from "vitest";
import { scoreHolding, persistScorecard, type MarketData, type Holding } from "./scorecard.js";
import { RUBRIC_BASE } from "../lib/rubric/base.js";
import { AEROSPACE_DEFENSE_OVERLAY } from "../lib/rubric/seed.js";
import { composeRubric } from "../lib/rubric/compose.js";
import type { Fundamentals } from "../lib/rubric/autoscore.js";

// A holding to score (fields the runner reads).
const HOLDING: Holding = {
  id: "holding-1",
  userId: "user-1",
  ticker: "ASTR",
  quantity: 10,
  costBasis: 1000,
  marketValue: 1000,
};

// Fundamentals chosen so deriveAutoScores produces a CLEAN, known `financial` score:
//   start 5  +1.5 (grossMargin>40)  +1.5 (revenueGrowth>25)  +1 (freeCashFlow>0)  = 9
// netMargin positive and debtToEquity<1 => no penalties.
const FUNDAMENTALS: Fundamentals = {
  pe: 20,
  eps: 2,
  revenue: 1_000_000,
  revenueGrowth: 30, // > 25  -> +1.5
  grossMargin: 50, // > 40  -> +1.5
  netMargin: 10, // >= 0  -> no penalty
  debtToEquity: 0.5, // <= 1  -> no penalty
  freeCashFlow: 500_000, // > 0   -> +1
  bookValue: 5,
  dividendYield: 0,
  beta: 1.1,
  fiftyTwoWeekHigh: 200,
  fiftyTwoWeekLow: 100,
};

// price == low52 => 52wk range position 0 => valuation auto-scores to exactly 10.
const MARKET: MarketData = {
  price: 100,
  high52: 200,
  low52: 100,
  fundamentals: FUNDAMENTALS,
};

describe("scoreHolding — known industry (aerospace_defense)", () => {
  it("produces the hand-computed total (80.5) and the correct action tier (normal)", () => {
    const row = scoreHolding(HOLDING, MARKET, "Aerospace & Defense");

    // Hand computation (composed weights: base scaled to fill 30, overlay = 70):
    //   valuation        10  * 7.5/10  = 7.50
    //   financial         9  * 7.5/10  = 6.75
    //   liquidity         5  * 3.0/10  = 1.50
    //   execution (seed)  5  * 4.5/10  = 2.25
    //   moat (seed)       5  * 7.5/10  = 3.75
    //   program_cadence  9.5 * 15/10   = 14.25
    //   next_gen_platform 7  * 15/10   = 10.50
    //   recurring_revenue 8  * 15/10   = 12.00
    //   government_moat   9  * 10/10   = 9.00
    //   competitive_pos  8.5 * 10/10   = 8.50
    //   optionality       9  * 5/10    = 4.50
    //   ---------------------------------------- total = 80.5
    expect(row.total).toBeCloseTo(80.5, 2);
    expect(row.action).toBe("normal"); // 80.5 is in [75, 85)
    expect(row.industry_key).toBe("aerospace_defense");
  });

  it("the composed rubric used end-to-end sums to 100 (±0.01)", () => {
    // Recompose with the same inputs the runner uses and assert the invariant directly.
    const rubric = composeRubric(RUBRIC_BASE, AEROSPACE_DEFENSE_OVERLAY);
    const sum = rubric.categories.reduce((s, c) => s + c.weight, 0);
    expect(sum).toBeCloseTo(100, 2);
    // 5 base spine + 6 overlay factors = 11 categories => the score map has 11 keys.
    const row = scoreHolding(HOLDING, MARKET, "Aerospace & Defense");
    expect(Object.keys(row.category_scores)).toHaveLength(11);
  });

  it("respects a saved judgment score over the seed (carry-forward)", () => {
    // Override moat from seed 5 -> 10. Composed moat weight is 7.5, so the total rises by
    // (10-5)/10 * 7.5 = 3.75 => 80.5 + 3.75 = 84.25.
    const row = scoreHolding(HOLDING, MARKET, "Aerospace & Defense", { moat: 10 });
    expect(row.total).toBeCloseTo(84.25, 2);
    expect(row.category_scores.moat).toBe(10);
  });
});

describe("scoreHolding — base-only path (null / unknown industry)", () => {
  it("scores with the 5-spine base only and yields the hand-computed total (72.5 -> small)", () => {
    // Unknown label resolves to null => empty overlay => base fills all 100:
    //   valuation 25, financial 25, liquidity 10, execution 15, moat 25
    //   valuation 10 *25/10 = 25.0
    //   financial  9 *25/10 = 22.5
    //   liquidity  5 *10/10 = 5.0
    //   execution  5 *15/10 = 7.5
    //   moat       5 *25/10 = 12.5
    //   ----------------------------- total = 72.5
    const row = scoreHolding(HOLDING, MARKET, "Llama Farming Conglomerate");
    expect(row.industry_key).toBeNull();
    expect(row.total).toBeCloseTo(72.5, 2);
    expect(row.action).toBe("small"); // 72.5 is in [65, 75)
    // base-only => exactly the 5 spine categories.
    expect(Object.keys(row.category_scores).sort()).toEqual(
      ["execution", "financial", "liquidity", "moat", "valuation"]
    );
  });

  it("treats a null industry label the same as the base-only path", () => {
    const row = scoreHolding(HOLDING, MARKET, null);
    expect(row.industry_key).toBeNull();
    expect(row.total).toBeCloseTo(72.5, 2);
  });
});

describe("scoreHolding — output row shape (holding_scorecards columns)", () => {
  it("carries holding_id / user_id / ticker through and includes a deploy block", () => {
    const row = scoreHolding(HOLDING, MARKET, "Aerospace & Defense");
    expect(row.holding_id).toBe("holding-1");
    expect(row.user_id).toBe("user-1");
    expect(row.ticker).toBe("ASTR");
    expect(row.total_delta).toBeNull(); // first run, no prior to diff
    // deploy is sizing guidance only — it has an action tier + a (non-order) amount.
    expect(row.deploy.action).toBe(row.action);
    expect(typeof row.deploy.amount).toBe("number");
  });
});

describe("persistScorecard — no-op DB seam", () => {
  it("returns the row with persisted:false when Supabase is not configured", async () => {
    // The test env has no SUPABASE_URL / SERVICE_ROLE_KEY, so this must NOT touch a DB.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const row = scoreHolding(HOLDING, MARKET, "Aerospace & Defense");
    const result = await persistScorecard(row);
    expect(result.persisted).toBe(false);
    expect(result.row).toBe(row);
  });
});

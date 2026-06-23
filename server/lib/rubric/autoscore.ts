// lib/rubric/autoscore.ts
//
// Ported from MarketPulse `lib/spcx/autoscore.ts`. The ONLY adaptation: spcx imported
// `Fundamentals` from `@/lib/providers/types` (a Next.js path alias that doesn't exist
// in the Thesis server). To keep `lib/rubric/` self-contained (no external imports, per
// the M1 constraints) we define the `Fundamentals` shape locally here. The scoring math
// — 52-wk valuation position, the margins/growth/FCF/leverage financial rubric, and the
// neutral-5 liquidity default — is byte-for-byte the spcx original.

/**
 * Fundamentals the auto-scorer reads. Mirrors the fields the spcx `Fundamentals` type
 * exposed; every field is nullable because free feeds (Finnhub free, Yahoo) routinely
 * omit them, and the scorer must stay null-safe.
 */
export interface Fundamentals {
  pe: number | null;
  eps: number | null;
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface AutoScoreInput {
  price: number;
  high52: number | null;
  low52: number | null;
  fundamentals: Fundamentals;
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function round1(n: number): number { return Math.round(n * 10) / 10; }

/**
 * Derive the auto/partial category scores from live data. Returns only the keys it can
 * compute — judgment categories are filled elsewhere (mergeScores). Generalized engine
 * keeps the universal-spine keys (`valuation`, `financial`, `liquidity`).
 */
export function deriveAutoScores(input: AutoScoreInput): Record<string, number> {
  const { price, high52, low52, fundamentals: f } = input;
  const out: Record<string, number> = {};

  // valuation: position in 52wk range; near low = cheap = high score.
  // (P/S is a deferred secondary nudge — revenue units in the feed need validation first.)
  if (high52 != null && low52 != null && high52 > low52) {
    const rangePos = clamp((price - low52) / (high52 - low52), 0, 1);
    out.valuation = round1(clamp(10 - 10 * rangePos, 0, 10));
  }

  // financial: rubric from margins / growth / FCF / leverage.
  let fin = 5;
  if (f.grossMargin != null && f.grossMargin > 40) fin += 1.5;
  if (f.revenueGrowth != null && f.revenueGrowth > 25) fin += 1.5;
  if (f.freeCashFlow != null && f.freeCashFlow > 0) fin += 1;
  if (f.netMargin != null && f.netMargin < 0) fin -= 1.5;
  if (f.debtToEquity != null && f.debtToEquity > 1) fin -= 1;
  out.financial = round1(clamp(fin, 0, 10));

  // liquidity: partial — short interest/borrow not in Finnhub free; neutral default.
  out.liquidity = 5;

  return out;
}

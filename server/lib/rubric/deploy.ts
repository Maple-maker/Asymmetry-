// lib/rubric/deploy.ts
//
// Ported VERBATIM from MarketPulse `lib/spcx/deploy.ts` — this file has no imports and
// was already ticker-/industry-agnostic, so the math is unchanged. The only edit is the
// type name: `SpcxAction` -> `RubricAction`, with a back-compat alias kept so any spcx
// fixture or caller still type-checks. Action tiers (>=85/>=75/>=65), the -15%/-25%
// DCA boosts, and the 25%/30% concentration caps are exactly as proven in spcx.

export type RubricAction = "aggressive" | "normal" | "small" | "pause";
/** Back-compat alias for the original spcx name. */
export type SpcxAction = RubricAction;

/**
 * Map a 0..100 weighted total to an action tier.
 * Tier boundaries are inclusive lower bounds (>=). Unchanged from spcx.
 */
export function decideAction(total: number): RubricAction {
  if (total >= 85) return "aggressive";
  if (total >= 75) return "normal";
  if (total >= 65) return "small";
  return "pause";
}

export interface DeployInput {
  total: number;
  budget: number;
  price: number;
  high52: number | null;
  positionValue: number;
  portfolioTotal: number;
}

export interface DeployResult {
  action: RubricAction;
  amount: number;
  multiplier: number;
  ruleFired: "normal" | "down15" | "down25";
  capped: "none" | "soft" | "hard";
  pctOffHigh: number;
  concentration: number;
}

// TUNABLE DEFAULTS — the model fixes the action tiers, not the exact dollar multipliers.
const BASE_MULT: Record<RubricAction, number> = { aggressive: 1.5, normal: 1.0, small: 0.5, pause: 0 };

function round2(n: number): number { return Math.round(n * 100) / 100; }

export function computeDeploy(input: DeployInput): DeployResult {
  const { total, budget, price, high52, positionValue, portfolioTotal } = input;
  const action = decideAction(total);

  const pctOffHigh = high52 != null && high52 > 0 ? ((high52 - price) / high52) * 100 : 0;
  const concentration = portfolioTotal > 0 ? (positionValue / portfolioTotal) * 100 : 0;

  // Price-drop boosts override the base multiplier (strongest wins), gated on thesis intact (>=65).
  let multiplier = BASE_MULT[action];
  let ruleFired: DeployResult["ruleFired"] = "normal";
  if (total >= 65 && pctOffHigh >= 25) { ruleFired = "down25"; multiplier = Math.max(multiplier, 2.0); }
  else if (total >= 65 && pctOffHigh >= 15) { ruleFired = "down15"; multiplier = Math.max(multiplier, 1.5); }

  // Concentration caps (hard stops on extra buys) + pause-and-review.
  let capped: DeployResult["capped"] = "none";
  let amount: number;
  if (concentration >= 30) { capped = "hard"; amount = 0; }
  else if (concentration >= 25) { capped = "soft"; amount = 0; }
  else if (total < 65) { amount = 0; }
  else { amount = Math.round(budget * multiplier); }

  return { action, amount, multiplier, ruleFired, capped, pctOffHigh: round2(pctOffHigh), concentration: round2(concentration) };
}

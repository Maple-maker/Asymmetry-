// lib/rubric/types.ts
//
// Net-new for Asymmetry (the SpaceX-only spcx port had no generalized types).
// These are the shared shapes the three-layer rubric engine works with.
// Pure TypeScript — no framework / Supabase imports — so this file mirrors the
// Python port 1:1 and stays trivially portable, exactly like the spcx originals.

/**
 * How a category's score is produced.
 *  - 'auto'     : fully derived from live market/fundamental data (e.g. valuation).
 *  - 'partial'  : partly derived; falls back to a neutral default when data is missing
 *                 (e.g. liquidity / short interest — neutral 5 until we have the feed).
 *  - 'judgment' : a human (or an AI *draft hint*) sets it; carried forward between runs.
 *
 * Layer C (AI gap-fill) only ever produces hints on 'judgment' categories — it never
 * auto-applies and never overrides an authored value (compliance constraint #8).
 */
export type SourceClass = "auto" | "partial" | "judgment";

/**
 * A single scored category inside a composed rubric.
 * `weight` is a percentage; the composed rubric's weights MUST sum to 100 (±0.01).
 */
export interface RubricCategory {
  key: string;
  label: string;
  weight: number; // percent
  sourceClass: SourceClass;
}

/**
 * A Layer-A base spine row, as stored in `rubric_base`.
 * `weight` here is a *starting* weight — compose.ts re-scales the base proportionally
 * to fill whatever the industry overlay leaves of 100 (the base-fill rule).
 * `derivation` documents which live signal feeds an auto/partial category (audit trail).
 */
export interface RubricBaseRow {
  key: string;
  label: string;
  weight: number;
  sourceClass: SourceClass;
  derivation: string | null;
}

/** Where an industry overlay came from (mirrors the `rubric_industry.origin` column). */
export type OverlayOrigin = "authored" | "ai_draft" | "ai_promoted";

/**
 * A Layer-B industry overlay, as stored in `rubric_industry`.
 * `categories` are authored (or AI-drafted) overlay factors whose weights sum to < 100;
 * the base fills the remainder at compose time.
 */
export interface IndustryOverlay {
  industryKey: string;
  categories: RubricCategory[];
  origin: OverlayOrigin;
}

/** The result of composing Layer A (base) + Layer B (overlay). Weights sum to 100. */
export interface Rubric {
  industryKey: string;
  categories: RubricCategory[];
}

/**
 * The curated ~15-key industry taxonomy (LOCKED 2026-06-23). NOT full GICS — a short
 * list we map each provider's industry field onto. A ticker that maps to none of these
 * resolves to `null`, which triggers Layer C (AI gap-fill).
 */
export type IndustryKey =
  | "aerospace_defense"
  | "semiconductors"
  | "software"
  | "banks"
  | "energy"
  | "biotech"
  | "consumer_retail"
  | "industrials"
  | "utilities"
  | "materials"
  | "telecom"
  | "reits"
  | "transport"
  | "media_entertainment"
  | "auto_ev";

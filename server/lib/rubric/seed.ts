// lib/rubric/seed.ts
//
// TS fixtures for tests + first-run composition. The canonical SQL seed lives in
// `supabase/` and is owned by another agent — this file is the TS-side mirror so the
// engine and its tests are self-contained (no DB needed to run vitest).
//
// `rubric_base` is re-exported from base.ts (single source of truth). The
// `aerospace_defense` overlay below is the spec's "industry #1": SpaceX's old spcx
// categories (launch / starship / starlink / government / competitive / optionality)
// reframed as a generic aerospace & defense thesis overlay. Authored overlay weights
// sum to 70 (< 100), so the base-fill rule fills the remaining 30 across the spine.
import type { IndustryOverlay } from "./types.js";
import { RUBRIC_BASE, BASE_SEED_SCORES } from "./base.js";

// Re-export the base spine so seed consumers have one import surface.
export { RUBRIC_BASE, BASE_SEED_SCORES };

/**
 * Layer-B overlay for aerospace & defense. Generalized from the spcx SpaceX model:
 *  - program_cadence   <- launch dominance / operational tempo
 *  - next_gen_platform <- Starship-style next-gen program progress
 *  - recurring_revenue <- Starlink-style recurring service economics
 *  - government_moat   <- government / defense contract moat
 *  - competitive_pos   <- competitive threat within the sector
 *  - optionality       <- strategic optionality (adjacent markets)
 * Authored weights sum to 70 — the base spine auto-fills the remaining 30.
 */
export const AEROSPACE_DEFENSE_OVERLAY: IndustryOverlay = {
  industryKey: "aerospace_defense",
  origin: "authored",
  categories: [
    { key: "program_cadence",   label: "Program cadence / operational tempo", weight: 15, sourceClass: "judgment" },
    { key: "next_gen_platform", label: "Next-gen platform progress",          weight: 15, sourceClass: "judgment" },
    { key: "recurring_revenue", label: "Recurring service economics",         weight: 15, sourceClass: "judgment" },
    { key: "government_moat",   label: "Government / defense moat",            weight: 10, sourceClass: "judgment" },
    { key: "competitive_pos",   label: "Competitive position in sector",      weight: 10, sourceClass: "judgment" },
    { key: "optionality",       label: "Strategic optionality",               weight: 5,  sourceClass: "judgment" },
  ],
};

/**
 * Seed (carry-forward fallback) scores for the aerospace_defense overlay's judgment
 * categories — mirrors the spcx working model's starting values, mapped to the new keys.
 */
export const AEROSPACE_DEFENSE_SEED_SCORES: Record<string, number> = {
  program_cadence: 9.5,   // was launch
  next_gen_platform: 7,   // was starship
  recurring_revenue: 8,   // was starlink
  government_moat: 9,     // was government
  competitive_pos: 8.5,   // was competitive
  optionality: 9,         // was optionality
};

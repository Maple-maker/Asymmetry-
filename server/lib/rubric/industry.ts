// lib/rubric/industry.ts
//
// Net-new for Asymmetry. Maps a data provider's free-text industry label (we lean on
// Finnhub `/stock/profile2` -> `finnhubIndustry`, matching MarketPulse) onto one of the
// curated ~15 IndustryKeys (LOCKED 2026-06-23 — NOT full GICS). Unknown -> null, which
// upstream triggers Layer C (AI gap-fill). spcx had nothing like this (it was SpaceX-only).
import type { IndustryKey } from "./types.js";

/** The locked curated taxonomy. Overlays are authored per key as they're built out. */
export const INDUSTRY_KEYS: readonly IndustryKey[] = [
  "aerospace_defense",
  "semiconductors",
  "software",
  "banks",
  "energy",
  "biotech",
  "consumer_retail",
  "industrials",
  "utilities",
  "materials",
  "telecom",
  "reits",
  "transport",
  "media_entertainment",
  "auto_ev",
] as const;

/**
 * Substring-match table: provider industry labels (lowercased) -> our IndustryKey.
 * Finnhub's `finnhubIndustry` values are the primary source (e.g. "Aerospace & Defense",
 * "Semiconductors", "Technology", "Banking"). We match on substrings so minor label
 * variants still resolve. Order matters: more specific substrings should appear first.
 */
const LABEL_MAP: ReadonlyArray<[match: string, key: IndustryKey]> = [
  ["aerospace", "aerospace_defense"],
  ["defense", "aerospace_defense"],
  ["semiconductor", "semiconductors"],
  // biotech must be matched BEFORE the broad "technology" rule, since "Biotechnology"
  // contains the substring "technology".
  ["biotech", "biotech"],
  ["pharmaceutical", "biotech"],
  ["life sciences", "biotech"],
  ["software", "software"],
  ["technology", "software"], // Finnhub lumps much of SaaS under "Technology"
  ["bank", "banks"],
  ["financial services", "banks"],
  ["oil", "energy"],
  ["gas", "energy"],
  ["energy", "energy"],
  ["retail", "consumer_retail"],
  ["consumer", "consumer_retail"],
  ["utilit", "utilities"], // "Utilities" / "Electric Utilities"
  ["metals", "materials"],
  ["mining", "materials"],
  ["chemical", "materials"],
  ["materials", "materials"],
  ["telecom", "telecom"],
  ["communication", "telecom"],
  ["reit", "reits"],
  ["real estate", "reits"],
  ["airline", "transport"],
  ["logistics", "transport"],
  ["transport", "transport"],
  ["railroad", "transport"],
  ["media", "media_entertainment"],
  ["entertainment", "media_entertainment"],
  ["auto", "auto_ev"],
  ["automobile", "auto_ev"],
  ["vehicle", "auto_ev"],
  ["industrial", "industrials"], // keep late: "industrial" is a broad fallback bucket
  ["machinery", "industrials"],
];

/**
 * Resolve a provider's industry label to one of the curated IndustryKeys.
 *
 * @param providerIndustry the raw label (e.g. Finnhub `finnhubIndustry`), or null/undefined
 * @returns an IndustryKey, or null if no mapping matches (caller then triggers Layer C)
 */
export function resolveIndustry(
  providerIndustry: string | null | undefined
): IndustryKey | null {
  if (!providerIndustry) return null;
  const label = providerIndustry.toLowerCase().trim();
  for (const [match, key] of LABEL_MAP) {
    if (label.includes(match)) return key;
  }
  return null;
}

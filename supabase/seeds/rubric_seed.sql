-- =============================================================================
-- Asymmetry — rubric seed
-- Layer A 5-spine (rubric_base) + the first Layer B overlay (aerospace_defense).
--
-- Apply AFTER 0001_init.sql, e.g.:
--   psql "$DATABASE_URL" -f supabase/seeds/rubric_seed.sql
--   (or run via supabase db push if wired into your seed step)
--
-- CANONICAL SOURCE: this SQL is kept in lockstep with the TS engine seed at
-- `server/lib/rubric/base.ts` + `server/lib/rubric/seed.ts` (which is covered by
-- the rubric vitest suite). The DB tables are the runtime source of truth; the TS
-- seed mirrors them so the engine/tests run without a DB. If you change one, change
-- both — the values below MUST match base.ts/seed.ts.
--
-- Weight model (from 2026-06-23-rubric-engine-spec.md):
--   * rubric_base weights are STARTING/relative weights. composeRubric re-scales
--     the base proportionally to fill (100 - overlaySum); their relative
--     proportions are what matter, not their absolute total (they sum to 100 here
--     purely for readability).
--   * Overlay weights are authored truth and MUST sum < 100 (leaving room for the
--     base). aerospace_defense below sums to 70, so the base fills the remaining 30.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Layer A — rubric_base (the 5-spine, present in every composed rubric)
-- Matches server/lib/rubric/base.ts RUBRIC_BASE exactly.
-- ---------------------------------------------------------------------------
insert into public.rubric_base (key, label, weight, source_class, derivation) values
  ('valuation', 'Valuation / market structure',           25, 'auto',     'valuation_range_pos'),
  ('financial', 'Financial strength',                      25, 'auto',     'financial_rubric'),
  ('liquidity', 'Liquidity / float / short interest',      10, 'partial',  'short_interest_neutral'),
  ('execution', 'Execution / management track record',     15, 'judgment', null),
  ('moat',      'Competitive position / moat',             25, 'judgment', null)
on conflict (key) do update set
  label        = excluded.label,
  weight       = excluded.weight,
  source_class = excluded.source_class,
  derivation   = excluded.derivation,
  updated_at   = now();

-- ---------------------------------------------------------------------------
-- Layer B — aerospace_defense overlay (industry #1).
-- Generalized from the SPCX model into a generic aerospace & defense thesis
-- (NOT SpaceX-specific). Overlay-specific factors only; valuation/financial/
-- liquidity/execution/moat live in the base. Matches seed.ts
-- AEROSPACE_DEFENSE_OVERLAY exactly. Sums to 70 (< 100), base fills 30.
-- ---------------------------------------------------------------------------
insert into public.rubric_industry (industry_key, categories, origin) values
  (
    'aerospace_defense',
    '[
      { "key": "program_cadence",   "label": "Program cadence / operational tempo", "weight": 15, "source_class": "judgment" },
      { "key": "next_gen_platform", "label": "Next-gen platform progress",          "weight": 15, "source_class": "judgment" },
      { "key": "recurring_revenue", "label": "Recurring service economics",         "weight": 15, "source_class": "judgment" },
      { "key": "government_moat",   "label": "Government / defense moat",            "weight": 10, "source_class": "judgment" },
      { "key": "competitive_pos",   "label": "Competitive position in sector",      "weight": 10, "source_class": "judgment" },
      { "key": "optionality",       "label": "Strategic optionality",               "weight":  5, "source_class": "judgment" }
    ]'::jsonb,
    'authored'
  )
on conflict (industry_key) do update set
  categories = excluded.categories,
  origin     = excluded.origin,
  updated_at = now();

commit;

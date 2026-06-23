# Asymmetry — Supabase schema (M0)

One Supabase project (Postgres + RLS) is the persistence + integration seam for Asymmetry.
The Python Radar V2 engine **writes** scored signals; the TS rubric engine (Thesis server)
**reads** them. No synchronous TS↔Python call on the request path.

## Layout

```
supabase/
├── migrations/
│   └── 0001_init.sql        # full schema for a fresh project (enums, tables, RLS, triggers)
├── seeds/
│   └── rubric_seed.sql      # rubric_base 5-spine + aerospace_defense overlay
└── README.md
```

## How to apply

This migration targets a **fresh** Postgres/Supabase project.

```bash
# From the repo root, link once to your remote project:
supabase link --project-ref <your-project-ref>

# Apply migrations (runs everything in supabase/migrations/ in order):
supabase db push

# Seed the rubric (run after the schema exists). Either wire it into your
# seed step, or apply directly:
psql "$DATABASE_URL" -f supabase/seeds/rubric_seed.sql
```

For local development with the full stack (requires Docker):

```bash
supabase start          # boots local Postgres
supabase db reset       # applies migrations + seed.sql to the local DB
```

> The seed uses `INSERT ... ON CONFLICT DO UPDATE`, so it is idempotent and safe to re-run.

## Table overview

### Shared reference / feed (no `user_id` — authenticated READ, service-role WRITE)
| Table | Purpose |
|---|---|
| `rubric_base` | Layer A — the 5-spine universal rubric (`valuation`, `financial`, `liquidity`, `execution`, `moat`). `weight` is a *starting* weight; `composeRubric` re-scales it at compose time. |
| `rubric_industry` | Layer B — industry overlays keyed by `industry_key`, `categories` jsonb, `origin` enum (`authored`/`ai_draft`/`ai_promoted`). `ai_draft` >90 days is stale until human-promoted. |
| `radar_opportunities` | Shared Radar V2 opportunity feed. `unique(ticker, as_of)`. |

### User-owned (RLS: `user_id = auth.uid()`)
| Table | Purpose | Notes |
|---|---|---|
| `connected_accounts` | SnapTrade brokerage links (`snaptrade_user_id`, `snaptrade_user_secret`, `snaptrade_authorization_id`, `brokerage`, `status`, `last_synced_at`). | **`snaptrade_user_secret` is service-role only** (see below). |
| `holdings` | SnapTrade-ingested positions (read-only). | Server writes; client reads own. |
| `holding_scorecards` | Append-only rubric scorecard per holding/day (`total`, `action`, `category_scores`, `deploy`). | INSERT-only for clients. |
| `holding_snapshots` | Append-only Radar V2 per-holding snapshot (`radar_score`, `reprice_gap`, `top_signals`). | INSERT-only for clients. |
| `thesis_matches` | Screener thesis↔ticker matches. | Full own-row CRUD. |
| `briefs` | Daily open/close briefs (`text`, `audio_url`). | `text` ships even if audio is null. |

## RLS model

RLS is enabled on **every** table. The Supabase **service role bypasses RLS** (used by the
server for ingest/scoring/writes); the **authenticated** role is constrained by the policies.

- **Shared reference/feed** (`rubric_base`, `rubric_industry`, `radar_opportunities`):
  authenticated users get a permissive `SELECT` policy. There are **no** insert/update/delete
  policies, so only the service role can write them.
- **User-owned tables**: every policy is scoped `user_id = (select auth.uid())`, so a user only
  ever sees/affects their own rows.
  - `holding_scorecards` / `holding_snapshots` are **append-only** — `SELECT` + `INSERT` policies
    only, no `UPDATE`/`DELETE`.
  - `connected_accounts`, `holdings`, `briefs` are **read-only for the client** (`SELECT` own
    rows); the server (service role) performs all writes.
  - `thesis_matches` allows full own-row CRUD for the client.

### `snaptrade_user_secret` — service-role ONLY (hard rule)

The SnapTrade user secret must **never** reach the client. Two layers enforce this:

1. **Column-level grant revoke** — `0001_init.sql` runs
   `REVOKE SELECT (snaptrade_user_secret) ON public.connected_accounts FROM authenticated, anon;`
   so even a user reading their own `connected_accounts` row cannot select the secret column.
2. **Safe view** — `connected_accounts_safe` (`security_invoker`) projects every column **except**
   `snaptrade_user_secret`. Client code should read from this view.

The service role bypasses both RLS and column grants, so server-side SnapTrade sync retains full
access to the secret.

## Compliance notes baked into the schema

- **Read-only**: there is no order/trade state anywhere in the schema. Scorecards, snapshots, and
  deploy fields are illustrative analysis only.
- **Auditable rubric**: every score row carries its `category_scores` + the rubric weights live in
  `rubric_base`/`rubric_industry`, so any total traces to category + weight + source class.
- **AI fills gaps, never overrides**: `rubric_industry.origin` distinguishes `authored` from
  `ai_draft`/`ai_promoted`; drafts stay drafts until a human promotes them.

## Verification status

The SQL was **not applied to a live database** in this environment (no Docker for `supabase start`,
no linked remote project, `psql` unavailable). It was validated by parsing both files against the
real PostgreSQL grammar via `pgsql-parser` (libpg_query): `0001_init.sql` → 70 statements parsed
clean, `rubric_seed.sql` → 4 statements parsed clean, plus a JSON validity check on the embedded
`categories` jsonb. **Treat "applies cleanly" as parser-verified but not runtime-verified** — run
`supabase db push` against a fresh project to confirm end-to-end.

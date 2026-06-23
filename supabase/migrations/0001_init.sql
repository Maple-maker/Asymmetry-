-- =============================================================================
-- Asymmetry — M0 initial schema
-- Fresh Postgres/Supabase project. SnapTrade holdings + three-layer rubric data model.
--
-- Design contract (from docs/ASYMMETRY-RELEASE-ROADMAP.md):
--   * RLS on EVERY user-owned table — users see only their own rows (user_id = auth.uid()).
--   * connected_accounts.snaptrade_user_secret is readable by the SERVICE ROLE ONLY;
--     it is NEVER exposed to the authenticated client (see column-level note + view below).
--   * rubric_base / rubric_industry / radar_opportunities are shared reference/feed:
--     authenticated users READ; only the service role WRITES.
--   * Read-only product: schema stores analysis only, never order state.
--
-- Apply with:  supabase db push
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- gen_random_uuid() lives in pgcrypto. (Supabase ships it; create if missing.)
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Source class for a rubric category (how its score is derived).
do $$ begin
  create type rubric_source_class as enum ('auto', 'partial', 'judgment');
exception when duplicate_object then null; end $$;

-- Provenance of an industry overlay (Layer C drafts vs. human-authored).
do $$ begin
  create type rubric_origin as enum ('authored', 'ai_draft', 'ai_promoted');
exception when duplicate_object then null; end $$;

-- Connected-account provider (SnapTrade for M2; room to grow).
do $$ begin
  create type account_provider as enum ('snaptrade');
exception when duplicate_object then null; end $$;

-- Capital-deploy action tier produced by decideAction().
do $$ begin
  create type scorecard_action as enum ('aggressive', 'normal', 'small', 'pause');
exception when duplicate_object then null; end $$;

-- Daily-brief session (market open / close).
do $$ begin
  create type brief_session as enum ('open', 'close');
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- SHARED REFERENCE / FEED TABLES  (auth read, service-role write — no user_id)
-- ===========================================================================

-- Layer A — universal base spine (the 5 categories present in every composed rubric).
-- `weight` is a *starting* / relative weight; composeRubric re-scales the base
-- proportionally at compose time to fill (100 - overlaySum).
create table public.rubric_base (
  key          text primary key,
  label        text                not null,
  weight       numeric             not null check (weight >= 0),
  source_class rubric_source_class not null,
  derivation   text                null,
  created_at   timestamptz         not null default now(),
  updated_at   timestamptz         not null default now()
);

comment on table public.rubric_base is
  'Layer A universal rubric spine (~5 rows). Shared reference: authenticated READ, service-role WRITE.';

-- Layer B — industry overlays, keyed by curated industry_key. One row per industry.
-- `categories` is a jsonb array of { key, label, weight, source_class }; overlay weights sum < 100.
create table public.rubric_industry (
  industry_key text primary key,
  categories   jsonb         not null,
  origin       rubric_origin not null default 'authored',
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

comment on table public.rubric_industry is
  'Layer B industry overlays (~15 rows). origin: authored|ai_draft|ai_promoted. ai_draft >90d is stale until human-promoted.';

-- Shared opportunity feed produced by the Radar V2 engine. No user scoping.
create table public.radar_opportunities (
  id          uuid primary key default gen_random_uuid(),
  ticker      text        not null,
  radar_score numeric     not null,
  reprice_gap numeric     null,
  top_signals jsonb       not null default '[]'::jsonb,
  as_of       date        not null,
  created_at  timestamptz not null default now(),
  unique (ticker, as_of)
);

comment on table public.radar_opportunities is
  'Shared Radar V2 feed (no user_id). Authenticated READ, service-role WRITE. unique(ticker, as_of).';

create index radar_opportunities_ticker_idx on public.radar_opportunities (ticker);
create index radar_opportunities_as_of_idx  on public.radar_opportunities (as_of desc);

-- ===========================================================================
-- USER-OWNED TABLES  (RLS: user_id = auth.uid())
-- ===========================================================================

-- SnapTrade-linked brokerage connection (READ-ONLY portfolio tracking).
-- SECURITY: snaptrade_user_secret is the sensitive credential (analogous to a
-- SnapTrade user_secret) and must be readable by the SERVICE ROLE ONLY.
-- RLS below grants the authenticated client SELECT on this table for its own
-- rows, but the client must NOT read snaptrade_user_secret. We enforce this two ways:
--   1) A column-level REVOKE of SELECT(snaptrade_user_secret) from authenticated/anon.
--   2) The connected_accounts_safe view (secret column omitted) for client reads.
-- The service role bypasses RLS and column grants, so server-side sync keeps the secret.
create table public.connected_accounts (
  id                        uuid             primary key default gen_random_uuid(),
  user_id                   uuid             not null references auth.users (id) on delete cascade,
  provider                  account_provider not null default 'snaptrade',
  snaptrade_user_id         text             not null,
  snaptrade_user_secret     text             not null,  -- SERVICE-ROLE ONLY (see column grants below)
  snaptrade_authorization_id text            null,       -- brokerage connection (BrokerageAuthorization) id
  brokerage                 text             null,
  account_id                text             null,       -- SnapTrade account id (from /accounts)
  status                    text             not null default 'active',
  linked_at                 timestamptz      null,
  last_synced_at            timestamptz      null,
  created_at                timestamptz      not null default now(),
  updated_at                timestamptz      not null default now(),
  unique (user_id, snaptrade_user_id)
);

comment on table public.connected_accounts is
  'SnapTrade brokerage links (read-only). RLS: own rows only. snaptrade_user_secret is SERVICE-ROLE ONLY (column SELECT revoked from authenticated/anon).';
comment on column public.connected_accounts.snaptrade_user_secret is
  'SnapTrade userSecret. NEVER expose to the client. Readable by the service role only; SELECT is revoked from authenticated & anon roles.';

create index connected_accounts_user_idx on public.connected_accounts (user_id);

-- Brokerage holdings (read-only ingest from SnapTrade /accounts/{id}/positions).
create table public.holdings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  account_id   uuid        null references public.connected_accounts (id) on delete set null,
  ticker       text        not null,
  quantity     numeric     null,
  cost_basis   numeric     null,
  market_value numeric     null,
  currency     text        not null default 'USD',
  thesis_id    uuid        null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.holdings is
  'SnapTrade-ingested holdings (read-only). RLS: own rows only.';

create index holdings_user_idx   on public.holdings (user_id);
create index holdings_ticker_idx on public.holdings (user_id, ticker);

-- Per-holding rubric scorecard. APPEND-ONLY (no updates/deletes by clients).
create table public.holding_scorecards (
  id              uuid primary key default gen_random_uuid(),
  holding_id      uuid             not null references public.holdings (id) on delete cascade,
  user_id         uuid             not null references auth.users (id) on delete cascade,
  ticker          text             not null,
  score_date      date             not null default current_date,
  industry_key    text             null references public.rubric_industry (industry_key),
  total           numeric          not null,
  total_delta     numeric          null,
  action          scorecard_action not null,
  category_scores jsonb            not null default '{}'::jsonb,
  deploy          jsonb            not null default '{}'::jsonb,
  created_at      timestamptz      not null default now()
);

comment on table public.holding_scorecards is
  'Append-only rubric scorecard per holding/day. RLS: own rows only; INSERT only (no client UPDATE/DELETE).';

create index holding_scorecards_holding_idx on public.holding_scorecards (holding_id, score_date desc);
create index holding_scorecards_user_idx    on public.holding_scorecards (user_id);

-- Per-holding Radar V2 signal snapshot. APPEND-ONLY.
create table public.holding_snapshots (
  id            uuid primary key default gen_random_uuid(),
  holding_id    uuid        not null references public.holdings (id) on delete cascade,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  ticker        text        not null,
  snapshot_date date        not null default current_date,
  radar_score   numeric     null,
  score_delta   numeric     null,
  reprice_gap   numeric     null,
  top_signals   jsonb       not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.holding_snapshots is
  'Append-only Radar V2 per-holding snapshot. RLS: own rows only; INSERT only (no client UPDATE/DELETE).';

create index holding_snapshots_holding_idx on public.holding_snapshots (holding_id, snapshot_date desc);
create index holding_snapshots_user_idx    on public.holding_snapshots (user_id);

-- Screener matches between a user thesis and a radar opportunity.
create table public.thesis_matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  thesis_id   uuid        null,
  ticker      text        not null,
  radar_score numeric     null,
  reprice_gap numeric     null,
  rationale   jsonb       not null default '{}'::jsonb,
  matched_at  timestamptz not null default now()
);

comment on table public.thesis_matches is
  'Screener thesis<->ticker matches. RLS: own rows only.';

create index thesis_matches_user_idx on public.thesis_matches (user_id);

-- Daily AI briefs (text + ElevenLabs audio).
create table public.briefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid          not null references auth.users (id) on delete cascade,
  session      brief_session not null,
  brief_date   date          not null default current_date,
  text         text          null,
  audio_url    text          null,
  delivered_at timestamptz   null,
  created_at   timestamptz   not null default now(),
  unique (user_id, session, brief_date)
);

comment on table public.briefs is
  'Daily open/close briefs. RLS: own rows only. text ships even if audio_url (ElevenLabs) is null.';

create index briefs_user_idx on public.briefs (user_id, brief_date desc);

-- ===========================================================================
-- updated_at triggers (tables that carry an updated_at column)
-- ===========================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_rubric_base_updated_at
  before update on public.rubric_base
  for each row execute function public.set_updated_at();

create trigger trg_rubric_industry_updated_at
  before update on public.rubric_industry
  for each row execute function public.set_updated_at();

create trigger trg_connected_accounts_updated_at
  before update on public.connected_accounts
  for each row execute function public.set_updated_at();

create trigger trg_holdings_updated_at
  before update on public.holdings
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- ROW-LEVEL SECURITY
-- ===========================================================================

-- Enable RLS on every table. With RLS enabled and no permissive policy for a
-- given role, that role is denied — the service role bypasses RLS entirely.

-- ---- Shared reference/feed: authenticated READ, no client write ----
alter table public.rubric_base         enable row level security;
alter table public.rubric_industry     enable row level security;
alter table public.radar_opportunities enable row level security;

create policy "rubric_base read for authenticated"
  on public.rubric_base for select
  to authenticated using (true);

create policy "rubric_industry read for authenticated"
  on public.rubric_industry for select
  to authenticated using (true);

create policy "radar_opportunities read for authenticated"
  on public.radar_opportunities for select
  to authenticated using (true);
-- No INSERT/UPDATE/DELETE policies => only the service role can write these.

-- ---- User-owned tables: own rows only (user_id = auth.uid()) ----
alter table public.connected_accounts enable row level security;
alter table public.holdings           enable row level security;
alter table public.holding_scorecards enable row level security;
alter table public.holding_snapshots  enable row level security;
alter table public.thesis_matches     enable row level security;
alter table public.briefs             enable row level security;

-- connected_accounts: client may read its own rows (token column is revoked separately).
-- Writes (token storage) are service-role only — no client INSERT/UPDATE/DELETE policy.
create policy "connected_accounts select own"
  on public.connected_accounts for select
  to authenticated using (user_id = (select auth.uid()));

-- holdings: server (service role) writes; client reads own. (Read-only product.)
create policy "holdings select own"
  on public.holdings for select
  to authenticated using (user_id = (select auth.uid()));

-- holding_scorecards: append-only. Client reads own; INSERT own; no UPDATE/DELETE.
create policy "holding_scorecards select own"
  on public.holding_scorecards for select
  to authenticated using (user_id = (select auth.uid()));
create policy "holding_scorecards insert own"
  on public.holding_scorecards for insert
  to authenticated with check (user_id = (select auth.uid()));

-- holding_snapshots: append-only. Client reads own; INSERT own; no UPDATE/DELETE.
create policy "holding_snapshots select own"
  on public.holding_snapshots for select
  to authenticated using (user_id = (select auth.uid()));
create policy "holding_snapshots insert own"
  on public.holding_snapshots for insert
  to authenticated with check (user_id = (select auth.uid()));

-- thesis_matches: full own-row CRUD for the client.
create policy "thesis_matches select own"
  on public.thesis_matches for select
  to authenticated using (user_id = (select auth.uid()));
create policy "thesis_matches insert own"
  on public.thesis_matches for insert
  to authenticated with check (user_id = (select auth.uid()));
create policy "thesis_matches update own"
  on public.thesis_matches for update
  to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "thesis_matches delete own"
  on public.thesis_matches for delete
  to authenticated using (user_id = (select auth.uid()));

-- briefs: client reads own; server writes.
create policy "briefs select own"
  on public.briefs for select
  to authenticated using (user_id = (select auth.uid()));

-- ===========================================================================
-- COLUMN-LEVEL HARDENING: snaptrade_user_secret is SERVICE-ROLE ONLY
-- ===========================================================================
-- Even though RLS lets a user SELECT its own connected_accounts row, the
-- SnapTrade userSecret must never reach the client. Revoke column SELECT from
-- the client roles. The service role bypasses these grants.
revoke select (snaptrade_user_secret) on public.connected_accounts from authenticated;
revoke select (snaptrade_user_secret) on public.connected_accounts from anon;

-- Safe projection for client reads (secret column intentionally omitted).
create view public.connected_accounts_safe
with (security_invoker = true) as
  select id, user_id, provider, snaptrade_user_id, snaptrade_authorization_id,
         brokerage, account_id, status, linked_at, last_synced_at,
         created_at, updated_at
  from public.connected_accounts;

comment on view public.connected_accounts_safe is
  'Client-facing projection of connected_accounts WITHOUT snaptrade_user_secret. security_invoker => caller RLS applies.';

commit;

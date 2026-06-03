-- No Fomo app schema
-- Extends the existing conviction_debates pipeline with app-facing tables

-- ── opportunity_feed (the app's read model) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunity_feed (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conviction_debate_id  UUID REFERENCES conviction_debates(id),
  ticker                TEXT NOT NULL,
  company_name          TEXT NOT NULL,
  tier                  INTEGER NOT NULL,
  overall_score         DECIMAL(5,2) NOT NULL,
  bluf                  TEXT NOT NULL,
  thesis                TEXT NOT NULL DEFAULT '',
  bull_case             TEXT,
  bear_case             TEXT,
  buy_zone_aggressive   DECIMAL(10,2),
  buy_zone_base         DECIMAL(10,2),
  buy_zone_conservative DECIMAL(10,2),
  catalyst              TEXT NOT NULL DEFAULT '',
  source_company        TEXT NOT NULL DEFAULT '',
  source_quote          TEXT,
  debate_verdict        TEXT NOT NULL DEFAULT 'NEUTRAL',
  gemini_verdict        TEXT NOT NULL DEFAULT 'NEUTRAL',
  deepseek_verdict      TEXT NOT NULL DEFAULT 'NEUTRAL',
  probability_score     DECIMAL(5,2) NOT NULL DEFAULT 65,
  market_miss           TEXT NOT NULL DEFAULT '',
  invalidation_trigger  TEXT NOT NULL DEFAULT '',
  snap                  JSONB,
  full_report_md        TEXT,
  is_premium            BOOLEAN NOT NULL DEFAULT FALSE,
  published_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asymmetry_score       INTEGER NOT NULL DEFAULT 5,
  conviction_score      INTEGER NOT NULL DEFAULT 5,
  catalyst_score        INTEGER NOT NULL DEFAULT 5,
  management_score      INTEGER NOT NULL DEFAULT 5,
  target_price          DECIMAL(10,2),
  floor_price           DECIMAL(10,2),
  upside_pct            DECIMAL(6,1),
  downside_pct          DECIMAL(6,1)
);

-- ── user_watchlist ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_watchlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  opportunity_id  UUID REFERENCES opportunity_feed(id),
  ticker          TEXT NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, ticker)
);

-- ── push_tokens ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  apns_token  TEXT NOT NULL,
  device_id   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, apns_token)
);

-- ── Indexes ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_feed_published    ON opportunity_feed(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_tier         ON opportunity_feed(tier);
CREATE INDEX IF NOT EXISTS idx_feed_score        ON opportunity_feed(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_user    ON user_watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_push_user         ON push_tokens(user_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE opportunity_feed  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlist    ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens       ENABLE ROW LEVEL SECURITY;

-- Public read for non-premium rows; premium requires authenticated session
CREATE POLICY "read_feed" ON opportunity_feed FOR SELECT
  USING (is_premium = FALSE OR auth.role() = 'authenticated');

-- Watchlist: users own their rows
CREATE POLICY "own_watchlist" ON user_watchlist FOR ALL
  USING (auth.uid()::text = user_id::text);

-- Push tokens: users own their rows
CREATE POLICY "own_push_tokens" ON push_tokens FOR ALL
  USING (auth.uid()::text = user_id::text);

-- ── get_watchlist RPC ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_watchlist(user_id UUID)
RETURNS SETOF opportunity_feed
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT f.*
  FROM opportunity_feed f
  JOIN user_watchlist w ON f.id = w.opportunity_id
  WHERE w.user_id = get_watchlist.user_id
  ORDER BY w.added_at DESC;
$$;

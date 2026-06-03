-- Triple Signal columns: market cap score, smart money (insider) score, triple signal flag
-- Added to both conviction_debates (source) and opportunity_feed (read model)

ALTER TABLE conviction_debates
  ADD COLUMN IF NOT EXISTS asymmetry_score   INTEGER,
  ADD COLUMN IF NOT EXISTS conviction_score  INTEGER,
  ADD COLUMN IF NOT EXISTS catalyst_score    INTEGER,
  ADD COLUMN IF NOT EXISTS management_score  INTEGER,
  ADD COLUMN IF NOT EXISTS target_price      DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS floor_price       DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS is_triple_signal  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS smart_money_score INTEGER,
  ADD COLUMN IF NOT EXISTS market_cap_score  INTEGER;

ALTER TABLE opportunity_feed
  ADD COLUMN IF NOT EXISTS is_triple_signal  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS smart_money_score INTEGER,
  ADD COLUMN IF NOT EXISTS market_cap_score  INTEGER;

CREATE INDEX IF NOT EXISTS idx_feed_triple ON opportunity_feed(is_triple_signal) WHERE is_triple_signal = TRUE;

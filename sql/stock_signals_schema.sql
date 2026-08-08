-- Saved per-stock activity signals (institutional / insider / politician).
-- Computed from 13F flows, Form 4 transactions, and congressional trades.
-- Run via: npm run db:init

CREATE TABLE IF NOT EXISTS stock_signal (
  ticker VARCHAR(16) NOT NULL,
  category VARCHAR(24) NOT NULL,
  label TEXT NOT NULL,
  direction VARCHAR(12) NOT NULL,
  strength VARCHAR(12) NOT NULL,
  buy_value_usd DOUBLE PRECISION,
  sell_value_usd DOUBLE PRECISION,
  net_value_usd DOUBLE PRECISION,
  ratio DOUBLE PRECISION,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, category)
);

CREATE INDEX IF NOT EXISTS idx_stock_signal_ticker ON stock_signal (ticker);
CREATE INDEX IF NOT EXISTS idx_stock_signal_direction ON stock_signal (direction);

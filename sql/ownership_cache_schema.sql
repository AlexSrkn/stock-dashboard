-- Precomputed ownership cache for the screener.
-- Heavy 13F aggregation happens once during ingestion (OwnershipCacheBuilder);
-- the screener performs only simple indexed lookups against these tables.
-- Run via: npm run db:init  (creates empty tables)  then  npm run ownership:build-cache

-- ---------------------------------------------------------------------------
-- Institution directory: one canonical row per institution.
-- normalized_name lets different spellings resolve to the same institution.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution (
  id SERIAL PRIMARY KEY,
  cik CHAR(10) UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'Other',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prefix search ("Black" -> blackrock) and substring fallback.
CREATE INDEX IF NOT EXISTS idx_institution_normalized
  ON institution (normalized_name text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_institution_name_lower
  ON institution (LOWER(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_institution_type ON institution (type);

-- ---------------------------------------------------------------------------
-- One row per ticker: precomputed aggregate ownership signals.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ownership_cache (
  ticker VARCHAR(16) PRIMARY KEY,
  institutional_ownership_pct DOUBLE PRECISION,
  insider_ownership_pct DOUBLE PRECISION,
  ownership_trend VARCHAR(12) NOT NULL DEFAULT 'neutral', -- increasing | decreasing | neutral
  institution_count INTEGER NOT NULL DEFAULT 0,
  current_shares DOUBLE PRECISION,
  previous_shares DOUBLE PRECISION,
  shares_outstanding DOUBLE PRECISION,
  top_institutions JSONB NOT NULL DEFAULT '[]'::jsonb,
  institution_types TEXT[] NOT NULL DEFAULT '{}',
  current_quarter VARCHAR(8),
  primary_cusip CHAR(9),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ownership_cache ADD COLUMN IF NOT EXISTS primary_cusip CHAR(9);

CREATE INDEX IF NOT EXISTS idx_ownership_cache_inst_pct
  ON ownership_cache (institutional_ownership_pct);
CREATE INDEX IF NOT EXISTS idx_ownership_cache_insider_pct
  ON ownership_cache (insider_ownership_pct);
CREATE INDEX IF NOT EXISTS idx_ownership_cache_trend ON ownership_cache (ownership_trend);
CREATE INDEX IF NOT EXISTS idx_ownership_cache_count ON ownership_cache (institution_count);
CREATE INDEX IF NOT EXISTS idx_ownership_cache_types
  ON ownership_cache USING GIN (institution_types);

-- ---------------------------------------------------------------------------
-- Per ticker x institution holdings (denormalized cache for "Held by" lookups).
-- Pure indexed lookup — no joins against raw 13F filing tables during filtering.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ownership_holding (
  ticker VARCHAR(16) NOT NULL,
  institution_cik CHAR(10) NOT NULL,
  institution_name TEXT NOT NULL,
  institution_type VARCHAR(32) NOT NULL DEFAULT 'Other',
  shares DOUBLE PRECISION NOT NULL,
  ownership_pct DOUBLE PRECISION,
  PRIMARY KEY (ticker, institution_cik)
);

CREATE INDEX IF NOT EXISTS idx_ownership_holding_cik ON ownership_holding (institution_cik);
CREATE INDEX IF NOT EXISTS idx_ownership_holding_ticker ON ownership_holding (ticker);
CREATE INDEX IF NOT EXISTS idx_ownership_holding_type ON ownership_holding (institution_type);

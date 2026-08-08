-- Performance indexes for ownership queries and issuer resolution (run after sec_holding_schema.sql)
-- Safe to re-run (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sec_holding_filer_quarter_cusip
  ON sec_holding (filer_cik, quarter, cusip);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sec_holding_cusip_quarter_filer
  ON sec_holding (cusip, quarter, filer_cik);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sec_holding_issuer_trgm
  ON sec_holding USING gin (issuer gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sec_filing_cik_filing_date_desc
  ON sec_filing (filer_cik, filing_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sec_holding_ticker_quarter
  ON sec_holding (ticker, quarter)
  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> '';

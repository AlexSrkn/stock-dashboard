-- Supports DISTINCT ON (filer_cik, quarter) … ORDER BY holdings_count DESC
-- (richest filing per quarter). Without this, ownership / smart-money CTEs
-- sort the full sec_filing table and can stall production.
--
-- Safe to run while the app is up:
--   sudo -u postgres psql -d tradeatlant -f sql/sec_filing_richest_index.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sec_filing_filer_quarter_richest
  ON sec_filing (
    filer_cik,
    quarter,
    holdings_count DESC NULLS LAST,
    total_value DESC NULLS LAST,
    filing_date DESC,
    id DESC
  );

-- SEC 13F filings + normalized holdings (Tradepile)
-- Run: psql $DATABASE_URL -f sql/sec_holding_schema.sql

CREATE TABLE IF NOT EXISTS sec_filing (
  id BIGSERIAL PRIMARY KEY,
  filer_cik CHAR(10) NOT NULL,
  accession_number VARCHAR(25) NOT NULL,
  fund_name TEXT NOT NULL,
  form_type VARCHAR(20) NOT NULL,
  filing_date DATE NOT NULL,
  report_period DATE,
  quarter VARCHAR(8) NOT NULL,
  info_table_document TEXT,
  holdings_count INTEGER NOT NULL DEFAULT 0,
  total_value BIGINT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sec_filing_accession_unique UNIQUE (accession_number)
);

CREATE INDEX IF NOT EXISTS idx_sec_filing_filer_cik ON sec_filing (filer_cik);
CREATE INDEX IF NOT EXISTS idx_sec_filing_filing_date ON sec_filing (filing_date DESC);
CREATE INDEX IF NOT EXISTS idx_sec_filing_quarter ON sec_filing (quarter);

CREATE TABLE IF NOT EXISTS sec_holding (
  id BIGSERIAL PRIMARY KEY,
  filing_id BIGINT NOT NULL REFERENCES sec_filing (id) ON DELETE CASCADE,
  filer_cik CHAR(10) NOT NULL,
  accession_number VARCHAR(25) NOT NULL,
  fund_name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  cusip CHAR(9) NOT NULL,
  ticker VARCHAR(16),
  shares NUMERIC(20, 4) NOT NULL,
  value BIGINT,
  value_usd_thousands BIGINT NOT NULL,
  filing_date DATE NOT NULL,
  quarter VARCHAR(8) NOT NULL,
  put_call VARCHAR(8),
  shares_type VARCHAR(8),
  security_type VARCHAR(8),
  option_type VARCHAR(8),
  discretion VARCHAR(8),
  title_of_class TEXT,
  row_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sec_holding_row_hash_unique UNIQUE (row_hash)
);

CREATE INDEX IF NOT EXISTS idx_sec_holding_filing_id ON sec_holding (filing_id);
CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_cik ON sec_holding (filer_cik);
CREATE INDEX IF NOT EXISTS idx_sec_holding_cusip ON sec_holding (cusip);
CREATE INDEX IF NOT EXISTS idx_sec_holding_quarter ON sec_holding (quarter);
CREATE INDEX IF NOT EXISTS idx_sec_holding_accession ON sec_holding (accession_number);
CREATE INDEX IF NOT EXISTS idx_sec_holding_cusip_quarter ON sec_holding (cusip, quarter);

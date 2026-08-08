-- SEC Form 13F-HR holdings (Tradepile)
-- value_usd_thousands: SEC reports market value in thousands of USD

CREATE TABLE IF NOT EXISTS sec_13f_filing (
  id BIGSERIAL PRIMARY KEY,
  filer_cik CHAR(10) NOT NULL,
  filer_name TEXT,
  accession_number VARCHAR(25) NOT NULL UNIQUE,
  form_type VARCHAR(20) NOT NULL,
  filing_date DATE NOT NULL,
  report_period DATE,
  info_table_document TEXT NOT NULL,
  holdings_count INTEGER NOT NULL DEFAULT 0,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_13f_filing_filer_cik ON sec_13f_filing (filer_cik);
CREATE INDEX IF NOT EXISTS idx_sec_13f_filing_filing_date ON sec_13f_filing (filing_date DESC);

CREATE TABLE IF NOT EXISTS sec_13f_holding (
  id BIGSERIAL PRIMARY KEY,
  filing_id BIGINT NOT NULL REFERENCES sec_13f_filing (id) ON DELETE CASCADE,
  filer_cik CHAR(10) NOT NULL,
  accession_number VARCHAR(25) NOT NULL,
  name_of_issuer TEXT NOT NULL,
  title_of_class VARCHAR(64) NOT NULL,
  cusip CHAR(9) NOT NULL,
  figi VARCHAR(12),
  value_usd_thousands BIGINT NOT NULL,
  shares_or_principal_amount NUMERIC(20, 4) NOT NULL,
  shares_or_principal_type VARCHAR(8),
  investment_discretion VARCHAR(8),
  put_call VARCHAR(8),
  other_manager VARCHAR(32),
  voting_sole NUMERIC(20, 4),
  voting_shared NUMERIC(20, 4),
  voting_none NUMERIC(20, 4),
  row_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_13f_holding_filing_id ON sec_13f_holding (filing_id);
CREATE INDEX IF NOT EXISTS idx_sec_13f_holding_cusip ON sec_13f_holding (cusip);
CREATE INDEX IF NOT EXISTS idx_sec_13f_holding_filer_cik ON sec_13f_holding (filer_cik);
CREATE INDEX IF NOT EXISTS idx_sec_13f_holding_accession ON sec_13f_holding (accession_number);

-- SEC XBRL financial periods (Filings Fundamentals)
CREATE TABLE IF NOT EXISTS sec_financial_period (
  id BIGSERIAL PRIMARY KEY,
  cik CHAR(10) NOT NULL,
  ticker VARCHAR(16),
  fiscal_year INTEGER NOT NULL,
  fiscal_period VARCHAR(4) NOT NULL,
  period_end DATE NOT NULL,
  form_type VARCHAR(20) NOT NULL,
  filed_date DATE NOT NULL,
  accession_number VARCHAR(25) NOT NULL,
  statement_scope VARCHAR(16) NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  metric_sources JSONB NOT NULL DEFAULT '{}',
  derived_metrics JSONB NOT NULL DEFAULT '{}',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sec_financial_period_scope_chk
    CHECK (statement_scope IN ('annual', 'quarterly')),
  CONSTRAINT sec_financial_period_fp_chk
    CHECK (fiscal_period IN ('FY', 'Q1', 'Q2', 'Q3', 'Q4')),
  CONSTRAINT sec_financial_period_filed_after_end_chk
    CHECK (filed_date >= period_end),
  UNIQUE (cik, fiscal_year, fiscal_period, statement_scope)
);

CREATE INDEX IF NOT EXISTS idx_sec_financial_period_cik ON sec_financial_period (cik);
CREATE INDEX IF NOT EXISTS idx_sec_financial_period_ticker ON sec_financial_period (ticker);
CREATE INDEX IF NOT EXISTS idx_sec_financial_period_end ON sec_financial_period (period_end DESC);

CREATE TABLE IF NOT EXISTS sec_earnings_release (
  id BIGSERIAL PRIMARY KEY,
  cik CHAR(10) NOT NULL,
  ticker VARCHAR(16),
  accession_number VARCHAR(25) NOT NULL,
  filing_date DATE NOT NULL,
  period_end DATE,
  items VARCHAR(64),
  metrics JSONB NOT NULL DEFAULT '{}',
  metric_sources JSONB NOT NULL DEFAULT '{}',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (accession_number)
);

CREATE INDEX IF NOT EXISTS idx_sec_earnings_release_cik ON sec_earnings_release (cik);

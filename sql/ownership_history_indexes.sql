-- Indexes for Ownership History rankings (13F QoQ).
-- Idealized institution_holdings → sec_holding / sec_filing

CREATE INDEX IF NOT EXISTS idx_sec_filing_filer_quarter_date
  ON sec_filing (filer_cik, quarter, filing_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_quarter
  ON sec_holding (filer_cik, quarter);

CREATE INDEX IF NOT EXISTS idx_sec_holding_quarter_filer
  ON sec_holding (quarter, filer_cik);

CREATE INDEX IF NOT EXISTS idx_sec_financial_period_ticker_shares
  ON sec_financial_period (ticker, period_end DESC, filed_date DESC)
  WHERE metrics ? 'shares_outstanding';

CREATE INDEX IF NOT EXISTS idx_insider_tx_ticker_code_date
  ON insider_transaction (ticker, transaction_code, transaction_date DESC)
  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> '';

CREATE INDEX IF NOT EXISTS idx_stocks_sector
  ON stocks (sector);


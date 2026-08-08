-- Optional indexes for institutional conviction / 13F portfolio analytics.
-- Safe to re-run (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_sec_holding_ticker_quarter
  ON sec_holding (ticker, quarter)
  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> '';

CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_quarter
  ON sec_holding (filer_cik, quarter);

CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_ticker_quarter
  ON sec_holding (filer_cik, ticker, quarter)
  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> '';

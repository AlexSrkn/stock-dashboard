-- Recommended indexes for Conflict Signals.

-- Safe to run repeatedly.

--

-- Idealized → actual:

--   institution_holdings → sec_holding / sec_filing (via holdingsLoader)

--   insider_transactions → insider_transaction



-- Open-market Form 4 window scans (P/S, non-derivative)

CREATE INDEX IF NOT EXISTS idx_insider_tx_open_market_date

  ON insider_transaction (transaction_date DESC)

  WHERE NOT is_derivative

    AND UPPER(BTRIM(transaction_code)) IN ('P', 'S');



CREATE INDEX IF NOT EXISTS idx_insider_tx_ticker_code_date

  ON insider_transaction (ticker, transaction_code, transaction_date DESC)

  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> '';



-- 13F QoQ joins used by loadInstitutionHoldings

CREATE INDEX IF NOT EXISTS idx_sec_filing_filer_quarter_date

  ON sec_filing (filer_cik, quarter, filing_date DESC, id DESC);



CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_quarter

  ON sec_holding (filer_cik, quarter);



-- Stock enrichment / sector filter

CREATE INDEX IF NOT EXISTS idx_stocks_sector

  ON stocks (sector);



CREATE INDEX IF NOT EXISTS idx_stocks_ticker

  ON stocks (ticker);



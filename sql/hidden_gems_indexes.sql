-- Indexes for Hidden Gems (13F QoQ ownership + accumulation).

-- Safe to run repeatedly.

--

-- Idealized → actual:

--   institution_holdings → sec_holding / sec_filing (loadInstitutionHoldings)

--   shares_outstanding   → sec_financial_period.metrics



CREATE INDEX IF NOT EXISTS idx_sec_filing_filer_quarter_date

  ON sec_filing (filer_cik, quarter, filing_date DESC, id DESC);



CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_quarter

  ON sec_holding (filer_cik, quarter);



CREATE INDEX IF NOT EXISTS idx_sec_financial_period_ticker_shares

  ON sec_financial_period (ticker, period_end DESC, filed_date DESC)

  WHERE metrics ? 'shares_outstanding';



CREATE INDEX IF NOT EXISTS idx_stocks_sector

  ON stocks (sector);



CREATE INDEX IF NOT EXISTS idx_stocks_ticker

  ON stocks (ticker);



-- Optional enrichment from ownership cache (current snapshot)

CREATE INDEX IF NOT EXISTS idx_ownership_cache_inst_pct

  ON ownership_cache (institutional_ownership_pct);



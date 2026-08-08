-- Recommended indexes for Holder Overlap (13F co-ownership queries).

-- Safe to run repeatedly. Prefer CONCURRENTLY in production to avoid locking.

--

-- Primary path uses ownership_holding (resolved tickers from ownership:build-cache).

-- Secondary indexes support fallback / raw 13F joins.



-- Fast "who holds ticker X" + type filter

CREATE INDEX IF NOT EXISTS idx_ownership_holding_ticker_type_cik

  ON ownership_holding (ticker, institution_type, institution_cik);



-- Fast "all holdings for these institutions"

CREATE INDEX IF NOT EXISTS idx_ownership_holding_cik_ticker

  ON ownership_holding (institution_cik, ticker);



-- Covering-ish for aggregation

CREATE INDEX IF NOT EXISTS idx_ownership_holding_ticker_shares

  ON ownership_holding (ticker, institution_cik) INCLUDE (shares, ownership_pct, institution_name, institution_type);



-- Stock sector filter / enrichment

CREATE INDEX IF NOT EXISTS idx_stocks_sector

  ON stocks (sector);



-- Ownership cache joins (shares outstanding / quarter)

CREATE INDEX IF NOT EXISTS idx_ownership_cache_ticker

  ON ownership_cache (ticker);



-- Insider buys for selected ticker

CREATE INDEX IF NOT EXISTS idx_insider_transaction_ticker_date

  ON insider_transaction (ticker, transaction_date DESC);



-- Latest filing lookups by filer + quarter (raw 13F path)

CREATE INDEX IF NOT EXISTS idx_sec_filing_filer_quarter_date

  ON sec_filing (filer_cik, quarter, filing_date DESC, id DESC);



CREATE INDEX IF NOT EXISTS idx_sec_holding_ticker_quarter_filer

  ON sec_holding (ticker, quarter, filer_cik)

  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> '';



CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_quarter_ticker

  ON sec_holding (filer_cik, quarter, ticker)

  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> '';



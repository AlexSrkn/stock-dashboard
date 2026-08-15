-- Immutable insider Form 4 transaction rows (append-only; dedupe via row_hash).

CREATE TABLE IF NOT EXISTS insider_transaction (
  id BIGSERIAL PRIMARY KEY,
  cik CHAR(10) NOT NULL,
  ticker VARCHAR(16),
  accession_number VARCHAR(24) NOT NULL,
  row_hash CHAR(64) NOT NULL,
  insider_name TEXT NOT NULL,
  insider_title TEXT,
  filing_date DATE,
  transaction_date DATE,
  transaction_code VARCHAR(4) NOT NULL,
  acquisition_disposition CHAR(1),
  shares NUMERIC(20, 4),
  price_per_share NUMERIC(20, 6),
  transaction_value NUMERIC(20, 2),
  ownership_nature VARCHAR(8),
  security_title TEXT,
  is_derivative BOOLEAN NOT NULL DEFAULT false,
  is_high_signal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT insider_transaction_row_hash_unique UNIQUE (row_hash)
);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_ticker_tx_date
  ON insider_transaction (ticker, transaction_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_ticker_filing_date
  ON insider_transaction (ticker, filing_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_ticker_high_signal
  ON insider_transaction (ticker, is_high_signal, transaction_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_cik
  ON insider_transaction (cik);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_accession
  ON insider_transaction (accession_number);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_tx_date
  ON insider_transaction (transaction_date DESC NULLS LAST)
  WHERE ticker IS NOT NULL AND NOT is_derivative;

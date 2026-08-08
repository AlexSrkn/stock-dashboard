-- Indexes for Repeat Buyers / Form 4 insider×ticker aggregations.
-- Real schema uses insider_name + ticker (no separate insider_id / stock_id FKs).

CREATE INDEX IF NOT EXISTS idx_insider_transaction_name_ticker
  ON insider_transaction (insider_name, ticker);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_name_tx_date
  ON insider_transaction (insider_name, transaction_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_insider_transaction_ticker_tx_date_code
  ON insider_transaction (ticker, transaction_date DESC NULLS LAST, transaction_code)
  WHERE NOT is_derivative AND UPPER(BTRIM(transaction_code)) IN ('P', 'S');

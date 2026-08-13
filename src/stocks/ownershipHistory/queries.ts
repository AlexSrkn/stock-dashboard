export const SELECT_STOCK_ENRICHMENT_SQL = `
SELECT
  ticker,
  company_name,
  sector
FROM stocks
WHERE ticker = ANY($1::varchar[])
`.trim();

export const SELECT_SHARES_OUTSTANDING_SQL = `
SELECT DISTINCT ON (UPPER(BTRIM(ticker)))
  UPPER(BTRIM(ticker)) AS ticker,
  (metrics->>'shares_outstanding')::float8 AS shares_outstanding
FROM sec_financial_period
WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''
  AND metrics ? 'shares_outstanding'
ORDER BY UPPER(BTRIM(ticker)), period_end DESC, filed_date DESC
`.trim();

/** Open-market Form 4 P/S counts by ticker in a lookback window. */
export const SELECT_INSIDER_FLOW_COUNTS_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  COUNT(*) FILTER (WHERE UPPER(BTRIM(transaction_code)) = 'P')::int AS buy_count,
  COUNT(*) FILTER (WHERE UPPER(BTRIM(transaction_code)) = 'S')::int AS sell_count
FROM insider_transaction
WHERE ticker IS NOT NULL
  AND BTRIM(ticker) <> ''
  AND NOT is_derivative
  AND UPPER(BTRIM(transaction_code)) IN ('P', 'S')
  AND (
    transaction_date >= (CURRENT_DATE - $1::int)
    OR (transaction_date IS NULL AND filing_date >= (CURRENT_DATE - $1::int))
  )
GROUP BY UPPER(BTRIM(ticker))
`.trim();


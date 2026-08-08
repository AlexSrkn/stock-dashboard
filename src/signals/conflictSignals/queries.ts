/**

 * Conflict Signals SQL — maps idealized schema to:

 *   institution_holdings → sec_holding + loadInstitutionHoldings (batch)

 *   insider_transactions → insider_transaction (open-market P/S only)

 *   stocks               → stocks

 */



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



/**

 * Open-market Form 4 only: transaction_code P (buy) / S (sell).

 * Excludes derivatives, grants, option exercises, and A/D compensation rows.

 */

export const SELECT_OPEN_MARKET_INSIDER_FLOW_SQL = `

SELECT

  UPPER(BTRIM(ticker)) AS ticker,

  insider_name,

  insider_title,

  transaction_date::text AS transaction_date,

  filing_date::text AS filing_date,

  COALESCE(transaction_value, 0)::float8 AS transaction_value,

  COALESCE(shares, 0)::float8 AS shares,

  UPPER(BTRIM(transaction_code)) AS transaction_code

FROM insider_transaction

WHERE ticker IS NOT NULL

  AND BTRIM(ticker) <> ''

  AND NOT is_derivative

  AND UPPER(BTRIM(transaction_code)) IN ('P', 'S')

  AND (

    transaction_date >= (CURRENT_DATE - $1::int)

    OR (transaction_date IS NULL AND filing_date >= (CURRENT_DATE - $1::int))

  )

`.trim();



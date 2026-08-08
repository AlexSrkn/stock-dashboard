/**

 * Hidden Gems SQL — idealized schema maps to:

 *   institution_holdings → sec_holding via loadInstitutionHoldings

 *   stocks / shares_outstanding → stocks + sec_financial_period

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



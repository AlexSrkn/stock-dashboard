import { sqlCommonStockOnly } from "../ownership/queries.js";

export const CTE_LATEST_FILINGS_BATCH = `
latest_filings AS (
  SELECT DISTINCT ON (filer_cik, quarter)
    id AS filing_id,
    filer_cik,
    quarter
  FROM sec_filing
  WHERE filer_cik = ANY($1::char(10)[])
  ORDER BY filer_cik, quarter, filing_date DESC, id DESC
)
`.trim();

/** QoQ position value change × log(1 + filer AUM), grouped by ticker. */
export const SELECT_INSTITUTIONAL_FLOW_BY_TICKER_SQL = `
WITH ${CTE_LATEST_FILINGS_BATCH},
recent_quarters AS (
  SELECT DISTINCT quarter FROM latest_filings ORDER BY quarter DESC LIMIT 2
),
cur_q AS (SELECT quarter FROM recent_quarters ORDER BY quarter DESC LIMIT 1),
prev_q AS (SELECT quarter FROM recent_quarters ORDER BY quarter DESC OFFSET 1 LIMIT 1),
filer_aum AS (
  SELECT DISTINCT ON (sf.filer_cik, sf.quarter)
    sf.filer_cik,
    sf.quarter,
    GREATEST(COALESCE(sf.total_value, 0), 0) * 1000.0 AS aum_usd
  FROM sec_filing sf
  WHERE sf.filer_cik = ANY($1::char(10)[])
  ORDER BY sf.filer_cik, sf.quarter, sf.filing_date DESC, sf.id DESC
),
holdings AS (
  SELECT
    h.filer_cik,
    h.quarter,
    UPPER(BTRIM(h.ticker)) AS ticker,
    SUM(COALESCE(h.value, h.value_usd_thousands) * 1000)::float8 AS position_value_usd
  FROM sec_holding h
  INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id AND h.quarter = lf.quarter
  WHERE h.filer_cik = ANY($1::char(10)[])
    AND h.ticker IS NOT NULL
    AND BTRIM(h.ticker) <> ''
    ${sqlCommonStockOnly("h")}
  GROUP BY h.filer_cik, h.quarter, UPPER(BTRIM(h.ticker))
)
SELECT
  c.ticker,
  SUM(
    (COALESCE(c.position_value_usd, 0) - COALESCE(p.position_value_usd, 0))
    * LN(1 + GREATEST(COALESCE(fa.aum_usd, 0), 0))
  )::float8 AS institutional_flow_raw
FROM holdings c
INNER JOIN cur_q ON c.quarter = cur_q.quarter
LEFT JOIN holdings p
  ON p.filer_cik = c.filer_cik
  AND p.ticker = c.ticker
  AND p.quarter = (SELECT quarter FROM prev_q)
LEFT JOIN filer_aum fa ON fa.filer_cik = c.filer_cik AND fa.quarter = c.quarter
GROUP BY c.ticker
`.trim();

export const SELECT_INSIDER_FLOW_ROWS_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  insider_title,
  transaction_value::float8 AS transaction_value,
  transaction_code,
  acquisition_disposition
FROM insider_transaction
WHERE ticker IS NOT NULL
  AND BTRIM(ticker) <> ''
  AND is_high_signal = true
  AND NOT is_derivative
  AND UPPER(transaction_code) IN ('P', 'S')
`.trim();

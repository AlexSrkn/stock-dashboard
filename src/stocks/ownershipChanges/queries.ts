import { sqlCommonStockOnly } from "../../ownership/queries.js";

export const SELECT_STOCK_ENRICHMENT_SQL = `
SELECT
  ticker,
  company_name,
  sector,
  cik
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

export const SELECT_AVAILABLE_QUARTERS_SQL = `
SELECT DISTINCT quarter
FROM sec_filing
WHERE quarter IS NOT NULL AND BTRIM(quarter) <> ''
ORDER BY quarter DESC
`.trim();

/** Latest filing per filer per quarter, restricted to $1 CIKs and $2 quarters. */
const CTE_LATEST_FILINGS_CIK_QUARTERS = `
latest_filings AS (
  SELECT DISTINCT ON (filer_cik, quarter)
    id AS filing_id,
    filer_cik,
    quarter
  FROM sec_filing
  WHERE filer_cik = ANY($1::char(10)[])
    AND quarter = ANY($2::text[])
  ORDER BY filer_cik, quarter,
    holdings_count DESC NULLS LAST,
    total_value DESC NULLS LAST,
    filing_date DESC,
    id DESC
)
`.trim();

/**
 * Pre-aggregate holdings in Postgres for ownership-movers warms.
 * Batches are disjoint by filer_cik, so Node can SUM institution_count across batches.
 * $1 = CIKs, $2 = quarters.
 */
export const SELECT_OWNERSHIP_TICKER_AGG_BATCH_SQL = `
WITH ${CTE_LATEST_FILINGS_CIK_QUARTERS},
cusip_map AS (
  SELECT DISTINCT ON (primary_cusip)
    primary_cusip,
    UPPER(BTRIM(ticker)) AS ticker
  FROM ownership_cache
  WHERE primary_cusip IS NOT NULL
    AND ticker IS NOT NULL
    AND BTRIM(ticker) <> ''
  ORDER BY primary_cusip, institution_count DESC NULLS LAST, ticker
),
per_filer AS (
  SELECT
    h.filer_cik,
    h.quarter,
    COALESCE(NULLIF(UPPER(BTRIM(h.ticker)), ''), cm.ticker) AS ticker,
    SUM(h.shares)::float8 AS shares,
    SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS market_value
  FROM sec_holding h
  INNER JOIN latest_filings lf
    ON h.filing_id = lf.filing_id
    AND h.filer_cik = lf.filer_cik
    AND h.quarter = lf.quarter
  LEFT JOIN cusip_map cm ON cm.primary_cusip = h.cusip
  WHERE h.filer_cik = ANY($1::char(10)[])
    AND h.quarter = ANY($2::text[])
    AND COALESCE(NULLIF(UPPER(BTRIM(h.ticker)), ''), cm.ticker) IS NOT NULL
    ${sqlCommonStockOnly("h")}
  GROUP BY h.filer_cik, h.quarter, COALESCE(NULLIF(UPPER(BTRIM(h.ticker)), ''), cm.ticker)
  HAVING SUM(h.shares) > 0
)
SELECT
  quarter,
  ticker,
  COUNT(*)::int AS institution_count,
  SUM(shares)::float8 AS shares,
  SUM(market_value)::float8 AS market_value
FROM per_filer
GROUP BY quarter, ticker
`.trim();

/** Distinct filers with holdings in each quarter (for default-quarter coverage checks). */
export const SELECT_OWNERSHIP_FILER_COUNT_BATCH_SQL = `
WITH ${CTE_LATEST_FILINGS_CIK_QUARTERS}
SELECT
  lf.quarter,
  COUNT(DISTINCT lf.filer_cik)::int AS filer_count
FROM latest_filings lf
GROUP BY lf.quarter
`.trim();

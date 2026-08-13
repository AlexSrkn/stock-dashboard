import { sqlCommonStockOnly } from "../../ownership/queries.js";

/** Latest filing per filer per quarter across tracked CIKs. */
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

/**
 * Common-stock holdings aggregated by filer, quarter, and CUSIP.
 * Tickers are resolved from issuer names after load (same as institution holdings UI).
 * market_value is USD dollars: prefer h.value (already USD); fall back to
 * value_usd_thousands * 1000 only when value is null.
 */
export const SELECT_INSTITUTION_HOLDINGS_BATCH_SQL = `
WITH ${CTE_LATEST_FILINGS_BATCH}
SELECT
  h.filer_cik AS institution_id,
  h.quarter,
  h.cusip,
  MAX(h.ticker) AS ticker,
  MAX(h.issuer) AS issuer,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS market_value
FROM sec_holding h
INNER JOIN latest_filings lf
  ON h.filing_id = lf.filing_id
  AND h.filer_cik = lf.filer_cik
  AND h.quarter = lf.quarter
WHERE h.filer_cik = ANY($1::char(10)[])
  ${sqlCommonStockOnly("h")}
GROUP BY h.filer_cik, h.quarter, h.cusip
HAVING SUM(h.shares) > 0
  AND SUM(COALESCE(h.value, h.value_usd_thousands * 1000)) > 0
ORDER BY h.filer_cik, h.quarter;
`.trim();

/** Distinct quarters available for a set of filers. */
export const SELECT_INSTITUTION_QUARTERS_BATCH_SQL = `
WITH ${CTE_LATEST_FILINGS_BATCH}
SELECT DISTINCT quarter
FROM latest_filings
ORDER BY quarter;
`.trim();

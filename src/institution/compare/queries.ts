import { sqlCommonStockOnly } from "../../ownership/queries.js";

/** Latest quarter holdings for multiple filers in one query (no row limit). */
export const SELECT_COMPARE_HOLDINGS_SQL = `
WITH latest_filings AS (
  SELECT DISTINCT ON (filer_cik, quarter)
    id AS filing_id,
    filer_cik,
    quarter,
    filing_date
  FROM sec_filing
  WHERE filer_cik = ANY($1::char(10)[])
  ORDER BY filer_cik, quarter,
    holdings_count DESC NULLS LAST,
    total_value DESC NULLS LAST,
    filing_date DESC,
    id DESC
),
latest_quarter AS (
  SELECT DISTINCT ON (filer_cik)
    filer_cik,
    filing_id,
    quarter,
    filing_date::text AS filing_date
  FROM latest_filings
  ORDER BY filer_cik, quarter DESC, filing_date DESC, filing_id DESC
)
SELECT
  lq.filer_cik,
  lq.quarter,
  lq.filing_date,
  h.cusip,
  MAX(h.ticker) AS ticker,
  MAX(h.issuer) AS issuer,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM latest_quarter lq
INNER JOIN sec_holding h
  ON h.filing_id = lq.filing_id
  AND h.quarter = lq.quarter
  AND h.filer_cik = lq.filer_cik
  ${sqlCommonStockOnly("h")}
GROUP BY lq.filer_cik, lq.quarter, lq.filing_date, h.cusip
HAVING SUM(h.shares) > 0
ORDER BY lq.filer_cik, SUM(COALESCE(h.value, h.value_usd_thousands)) DESC NULLS LAST
`.trim();

export { SELECT_STOCK_ENRICHMENT_SQL } from "../mostAccumulated/queries.js";

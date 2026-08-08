import { sqlCommonStockOnly, sqlOptionTypeOnly } from "../ownership/queries.js";

/** Latest 13F filing per quarter for one filer. */
export const CTE_LATEST_FILINGS_FOR_FILER = `
latest_filings AS (
  SELECT DISTINCT ON (quarter)
    id AS filing_id,
    quarter,
    filing_date
  FROM sec_filing
  WHERE filer_cik = $1
  ORDER BY quarter, filing_date DESC, id DESC
)
`.trim();

export const SELECT_FILER_QUARTERS_SQL = `
WITH ${CTE_LATEST_FILINGS_FOR_FILER}
SELECT quarter
FROM latest_filings
ORDER BY quarter DESC
LIMIT $2;
`.trim();

export const SELECT_FILER_PROFILE_STATS_SQL = `
WITH ${CTE_LATEST_FILINGS_FOR_FILER}
SELECT
  COUNT(DISTINCT f.id)::int AS filings_count,
  MAX(f.filing_date)::text AS latest_filing_date
FROM sec_filing f
WHERE f.filer_cik = $1;
`.trim();

export const SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL = `
WITH ${CTE_LATEST_FILINGS_FOR_FILER}
SELECT
  h.cusip,
  MAX(h.ticker) AS ticker,
  MAX(h.issuer) AS issuer,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding h
INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id AND h.quarter = lf.quarter
WHERE h.filer_cik = $1
  AND h.quarter = $2
  ${sqlCommonStockOnly("h")}
GROUP BY h.cusip
HAVING SUM(h.shares) > 0
ORDER BY SUM(COALESCE(h.value, h.value_usd_thousands)) DESC NULLS LAST
LIMIT $3;
`.trim();

function filerOptionsForQuarterSql(optionType: "Call" | "Put"): string {
  return `
WITH ${CTE_LATEST_FILINGS_FOR_FILER}
SELECT
  h.cusip,
  MAX(h.ticker) AS ticker,
  MAX(h.issuer) AS issuer,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding h
INNER JOIN latest_filings lf ON h.filing_id = lf.filing_id AND h.quarter = lf.quarter
WHERE h.filer_cik = $1
  AND h.quarter = $2
  ${sqlOptionTypeOnly(optionType, "h")}
GROUP BY h.cusip
HAVING SUM(h.shares) > 0
ORDER BY SUM(COALESCE(h.value, h.value_usd_thousands)) DESC NULLS LAST
LIMIT $3;
`.trim();
}

export const SELECT_FILER_CALLS_FOR_QUARTER_SQL = filerOptionsForQuarterSql("Call");
export const SELECT_FILER_PUTS_FOR_QUARTER_SQL = filerOptionsForQuarterSql("Put");

export const SELECT_FILER_FILINGS_HISTORY_SQL = `
SELECT
  accession_number,
  form_type,
  filing_date::text AS filing_date,
  report_period::text AS report_period,
  quarter,
  holdings_count,
  total_value,
  info_table_document
FROM sec_filing
WHERE filer_cik = $1
ORDER BY filing_date DESC, id DESC
LIMIT $2;
`.trim();

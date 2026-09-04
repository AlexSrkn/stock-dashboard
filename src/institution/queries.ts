import { sqlCommonStockOnly, sqlOptionTypeOnly } from "../ownership/queries.js";

/**
 * Latest substantive 13F filing per quarter for one or more filer CIKs.
 * Prefer the richest filing (holdings_count / total_value) so thin late
 * amendments (e.g. Amundi "NEW HOLDINGS" with one line) do not replace the
 * full combination report for that quarter.
 *
 * $1 = char(10)[] of filer CIKs
 */
export const CTE_LATEST_FILINGS_FOR_FILERS = `
latest_filings AS (
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
)
`.trim();

export const SELECT_FILER_QUARTERS_SQL = `
WITH ${CTE_LATEST_FILINGS_FOR_FILERS}
SELECT DISTINCT quarter
FROM latest_filings
ORDER BY quarter DESC
LIMIT $2;
`.trim();

export const SELECT_FILER_PROFILE_STATS_SQL = `
SELECT
  COUNT(DISTINCT f.id)::int AS filings_count,
  MAX(f.filing_date)::text AS latest_filing_date
FROM sec_filing f
WHERE f.filer_cik = ANY($1::char(10)[]);
`.trim();

export const SELECT_FILER_HOLDINGS_FOR_QUARTER_SQL = `
WITH ${CTE_LATEST_FILINGS_FOR_FILERS}
SELECT
  h.cusip,
  MAX(h.ticker) AS ticker,
  MAX(h.issuer) AS issuer,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding h
INNER JOIN latest_filings lf
  ON h.filing_id = lf.filing_id
  AND h.filer_cik = lf.filer_cik
  AND h.quarter = lf.quarter
WHERE h.filer_cik = ANY($1::char(10)[])
  AND h.quarter = $2
  ${sqlCommonStockOnly("h")}
GROUP BY h.cusip
HAVING SUM(h.shares) > 0
ORDER BY SUM(COALESCE(h.value, h.value_usd_thousands)) DESC NULLS LAST
LIMIT $3;
`.trim();

function filerOptionsForQuarterSql(optionType: "Call" | "Put"): string {
  return `
WITH ${CTE_LATEST_FILINGS_FOR_FILERS}
SELECT
  h.cusip,
  MAX(h.ticker) AS ticker,
  MAX(h.issuer) AS issuer,
  SUM(h.shares)::float8 AS shares,
  SUM(COALESCE(h.value, h.value_usd_thousands))::float8 AS value_usd_thousands
FROM sec_holding h
INNER JOIN latest_filings lf
  ON h.filing_id = lf.filing_id
  AND h.filer_cik = lf.filer_cik
  AND h.quarter = lf.quarter
WHERE h.filer_cik = ANY($1::char(10)[])
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

/** Filing history for the requested profile CIK only (not the whole group). */
export const SELECT_FILER_FILINGS_HISTORY_SQL = `
SELECT
  accession_number,
  form_type,
  filing_date::text AS filing_date,
  report_period,
  quarter,
  holdings_count,
  total_value
FROM sec_filing
WHERE filer_cik = $1
ORDER BY filing_date DESC, id DESC
LIMIT $2;
`.trim();

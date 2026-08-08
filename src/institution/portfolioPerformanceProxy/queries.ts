import { formatSecCik } from "../../sec/http.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../../ownership/trackedInstitutions.js";

export function trackedInstitutionCiks(): string[] {
  return [...TRACKED_INSTITUTIONAL_CIK_PADDED].map((c) => formatSecCik(c));
}

/**
 * Latest filing per filer/quarter with reported portfolio value.
 * total_value is stored in USD thousands (sum of holding values at ingest).
 */
export const SELECT_PORTFOLIO_VALUE_HISTORY_SQL = `
WITH latest_filings AS (
  SELECT DISTINCT ON (filer_cik, quarter)
    id AS filing_id,
    filer_cik,
    quarter,
    filing_date,
    holdings_count,
    total_value
  FROM sec_filing
  WHERE filer_cik = ANY($1::char(10)[])
  ORDER BY filer_cik, quarter, filing_date DESC, id DESC
)
SELECT
  lf.filer_cik AS institution_id,
  lf.quarter,
  lf.filing_date::text AS filing_date,
  COALESCE(lf.holdings_count, 0)::int AS holdings_count,
  (COALESCE(lf.total_value, 0) * 1000)::float8 AS portfolio_value_usd
FROM latest_filings lf
WHERE COALESCE(lf.total_value, 0) > 0
ORDER BY lf.filer_cik, lf.quarter
`.trim();

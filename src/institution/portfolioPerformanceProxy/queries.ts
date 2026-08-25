import { formatSecCik } from "../../sec/http.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../../ownership/trackedInstitutions.js";

export function trackedInstitutionCiks(): string[] {
  return [...TRACKED_INSTITUTIONAL_CIK_PADDED].map((c) => formatSecCik(c));
}

/**
 * Latest substantive filing per filer/quarter with reported portfolio value.
 *
 * Some ingested rows still store SEC thousands; others store full USD. When the
 * majority of detectable holdings imply price value/shares < $1, treat the
 * filing total as thousands and ×1000. Prefer the filing with the largest
 * reported portfolio for the quarter so late thin amendments do not win.
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
  ORDER BY filer_cik, quarter,
    total_value DESC NULLS LAST,
    holdings_count DESC NULLS LAST,
    filing_date DESC,
    id DESC
),
unit_votes AS (
  SELECT
    h.filing_id,
    COUNT(*) FILTER (
      WHERE h.value IS NOT NULL
        AND h.value > 0
        AND h.shares IS NOT NULL
        AND h.shares >= 100
        AND (h.value / h.shares) < 1
    )::int AS thousands_votes,
    COUNT(*) FILTER (
      WHERE h.value IS NOT NULL
        AND h.value > 0
        AND h.shares IS NOT NULL
        AND h.shares >= 100
        AND (h.value / h.shares) >= 1
    )::int AS dollars_votes
  FROM sec_holding h
  INNER JOIN latest_filings lf ON lf.filing_id = h.filing_id
  GROUP BY h.filing_id
)
SELECT
  lf.filer_cik AS institution_id,
  lf.quarter,
  lf.filing_date::text AS filing_date,
  COALESCE(lf.holdings_count, 0)::int AS holdings_count,
  (
    CASE
      WHEN COALESCE(uv.thousands_votes, 0) > COALESCE(uv.dollars_votes, 0)
      THEN COALESCE(lf.total_value, 0) * 1000.0
      ELSE COALESCE(lf.total_value, 0)
    END
  )::float8 AS portfolio_value_usd
FROM latest_filings lf
LEFT JOIN unit_votes uv ON uv.filing_id = lf.filing_id
WHERE COALESCE(lf.total_value, 0) > 0
ORDER BY lf.filer_cik, lf.quarter
`.trim();


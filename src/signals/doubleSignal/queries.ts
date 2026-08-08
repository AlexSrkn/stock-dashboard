import { formatSecCik } from "../../sec/http.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../../ownership/trackedInstitutions.js";

export function trackedInstitutionCiks(): string[] {
  return [...TRACKED_INSTITUTIONAL_CIK_PADDED].map((c) => formatSecCik(c));
}

export const SELECT_LATEST_13F_FILING_DATE_SQL = `
SELECT MAX(filing_date)::text AS latest_filing_date
FROM sec_filing
WHERE filer_cik = ANY($1::char(10)[])
`.trim();

export const SELECT_RECENT_FILINGS_IN_WINDOW_SQL = `
SELECT DISTINCT ON (filer_cik)
  filer_cik AS institution_id,
  quarter,
  filing_date::text AS filing_date
FROM sec_filing
WHERE filer_cik = ANY($1::char(10)[])
  AND filing_date >= (CURRENT_DATE - $2::int)
ORDER BY filer_cik, filing_date DESC, id DESC
`.trim();

export const SELECT_INSIDER_BUYS_IN_WINDOW_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  insider_name AS "insiderName",
  insider_title AS "insiderTitle",
  transaction_date::text AS "transactionDate",
  COALESCE(transaction_value, 0)::float8 AS "transactionValue",
  COALESCE(shares, 0)::float8 AS shares,
  cik
FROM insider_transaction
WHERE ticker IS NOT NULL
  AND BTRIM(ticker) <> ''
  AND NOT is_derivative
  AND transaction_date IS NOT NULL
  AND transaction_date >= (CURRENT_DATE - $1::int)
  AND UPPER(BTRIM(transaction_code)) = 'P'
`.trim();

export { SELECT_STOCK_ENRICHMENT_SQL } from "../../institution/mostAccumulated/queries.js";

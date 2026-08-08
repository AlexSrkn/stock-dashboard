import { formatSecCik } from "../../sec/http.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../../ownership/trackedInstitutions.js";

export function trackedInstitutionCiks(): string[] {
  return [...TRACKED_INSTITUTIONAL_CIK_PADDED].map((c) => formatSecCik(c));
}

/** Latest filing per tracked filer in the last 30 calendar days. */
export const SELECT_RECENT_FILING_QUARTERS_SQL = `
SELECT DISTINCT ON (filer_cik)
  filer_cik AS institution_id,
  quarter,
  filing_date::text AS filing_date
FROM sec_filing
WHERE filer_cik = ANY($1::char(10)[])
  AND filing_date >= (CURRENT_DATE - INTERVAL '30 days')
ORDER BY filer_cik, filing_date DESC, id DESC
`.trim();

/** Latest filing date per filer+quarter for tracked institutions. */
export const SELECT_FILING_DATES_SQL = `
SELECT DISTINCT ON (filer_cik, quarter)
  filer_cik AS institution_id,
  quarter,
  filing_date::text AS filing_date
FROM sec_filing
WHERE filer_cik = ANY($1::char(10)[])
ORDER BY filer_cik, quarter, filing_date DESC, id DESC
`.trim();

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

export const SELECT_INSIDER_FLOW_IN_WINDOW_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  insider_name,
  insider_title,
  transaction_date::text AS transaction_date,
  filing_date::text AS filing_date,
  transaction_value::float8 AS transaction_value,
  transaction_code,
  acquisition_disposition
FROM insider_transaction
WHERE ticker IS NOT NULL
  AND BTRIM(ticker) <> ''
  AND NOT is_derivative
  AND (
    transaction_date >= (CURRENT_DATE - $1::int)
    OR (transaction_date IS NULL AND filing_date >= (CURRENT_DATE - $1::int))
  )
  AND (
    UPPER(BTRIM(transaction_code)) IN ('P', 'S')
    OR UPPER(BTRIM(COALESCE(acquisition_disposition, ''))) IN ('A', 'D')
  )
`.trim();

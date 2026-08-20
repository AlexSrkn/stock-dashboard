import { formatSecCik } from "../../sec/http.js";
import { INSTITUTIONAL_13F_MANAGERS } from "../../sec/seed/institutional-ciks.js";
import { TRACKED_INSTITUTIONAL_CIK_PADDED } from "../../ownership/trackedInstitutions.js";

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

/**
 * Full curated + imported tracked universe (localhost-scale Institutions Buying counts).
 * Warmers must batch-load holdings — never pull all filers into Node at once.
 */
export function trackedInstitutionCiks(): string[] {
  return [...TRACKED_INSTITUTIONAL_CIK_PADDED].map((c) => formatSecCik(c));
}

/** Curated seed only — safe for smaller warm jobs (e.g. institutional accumulation). */
export function curatedInstitutionCiks(): string[] {
  return INSTITUTIONAL_13F_MANAGERS.filter((m) => m.cik)
    .map((m) => formatSecCik(m.cik as string));
}

export const SELECT_STOCK_ENRICHMENT_SQL = `
SELECT
  ticker,
  company_name,
  sector
FROM stocks
WHERE ticker = ANY($1::varchar[])
`.trim();

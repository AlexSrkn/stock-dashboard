import { formatSecCik } from "../../sec/http.js";
import { INSTITUTIONAL_13F_MANAGERS } from "../../sec/seed/institutional-ciks.js";

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
 * Curated seed only — not the full imported 13F universe.
 * Ranking over thousands of filers OOMs the 4GB VPS during warm/compute.
 */
export function trackedInstitutionCiks(): string[] {
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

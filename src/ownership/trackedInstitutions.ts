import {
  INSTITUTIONAL_13F_MANAGERS,
  type Institutional13FManager,
} from "../sec/seed/institutional-ciks.js";
import { formatSecCik } from "../sec/http.js";

export function paddedInstitutionalCik(cik: string): string {
  return formatSecCik(cik);
}

/** Curated 13F filers with verified CIKs (padded for `sec_holding.filer_cik`). */
export const TRACKED_INSTITUTIONAL_MANAGERS: readonly Institutional13FManager[] =
  INSTITUTIONAL_13F_MANAGERS.filter(
    (m): m is Institutional13FManager & { cik: string } => m.cik != null && m.cik !== ""
  );

export const TRACKED_INSTITUTIONAL_CIK_PADDED: readonly string[] =
  TRACKED_INSTITUTIONAL_MANAGERS.map((m) => paddedInstitutionalCik(m.cik));

const byCik = new Map<string, Institutional13FManager>();
for (const manager of TRACKED_INSTITUTIONAL_MANAGERS) {
  byCik.set(paddedInstitutionalCik(manager.cik), manager);
}

export function getTrackedInstitutionByCik(
  filerCik: string
): Institutional13FManager | undefined {
  return byCik.get(paddedInstitutionalCik(filerCik));
}

export function canonicalFundName(filerCik: string, fundNameFromDb: string): string {
  return getTrackedInstitutionByCik(filerCik)?.name ?? fundNameFromDb;
}

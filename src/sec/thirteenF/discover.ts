import type { SecCompanySubmissions } from "../submissions.js";
import type { Sec13FFilingRef } from "./types.js";

const FORM_13F = new Set(["13F-HR", "13F-HR/A"]);

export function is13FFormType(form: string): boolean {
  const f = String(form || "").trim().toUpperCase();
  return FORM_13F.has(f);
}

/**
 * List recent 13F-HR / 13F-HR/A filings from a submissions JSON payload.
 */
export function discover13FFilings(
  submissions: SecCompanySubmissions,
  limit = 10
): Sec13FFilingRef[] {
  const recent = submissions.filings?.recent;
  if (!recent?.form?.length) return [];

  const filerCik = String(submissions.cik).padStart(10, "0");
  const filerName = submissions.name ?? null;
  const candidates: Sec13FFilingRef[] = [];

  for (let i = 0; i < recent.form.length; i++) {
    const form = String(recent.form[i] || "").trim();
    if (!is13FFormType(form)) continue;

    candidates.push({
      filerCik,
      filerName,
      accessionNumber: recent.accessionNumber?.[i] ?? "",
      formType: form,
      filingDate: recent.filingDate?.[i] ?? "",
      reportDate: recent.reportDate?.[i] ?? null,
      primaryDocument: recent.primaryDocument?.[i] ?? null,
    });
  }

  candidates.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

  return candidates.filter((f) => f.accessionNumber).slice(0, limit);
}

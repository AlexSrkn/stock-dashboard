import type { SecCompanySubmissions, SecFilingsRecent } from "../submissions.js";
import { formatSecCik } from "../http.js";
import type { Form4FilingRef } from "./types.js";

const FORM4_FORMS = new Set(["4", "4/A"]);

function parseFilingDate(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(da) && !Number.isFinite(db)) return 0;
  if (!Number.isFinite(da)) return -1;
  if (!Number.isFinite(db)) return 1;
  return db - da;
}

/**
 * Recent Form 4 / 4/A filings from submissions JSON, newest first.
 */
export function discoverForm4Filings(
  submissions: SecCompanySubmissions,
  limit = 50
): Form4FilingRef[] {
  const recent = submissions.filings?.recent;
  if (!recent?.form?.length) return [];

  const filerCik = formatSecCik(submissions.cik);
  const filerName = submissions.name ?? null;
  const cap = Math.min(recent.form.length, 500);
  const refs: Form4FilingRef[] = [];

  for (let i = 0; i < cap; i++) {
    const form = String(recent.form[i] ?? "").trim();
    if (!FORM4_FORMS.has(form)) continue;

    const accessionNumber = String(recent.accessionNumber?.[i] ?? "").trim();
    if (!accessionNumber) continue;

    refs.push({
      filerCik,
      accessionNumber,
      form,
      filingDate: String(recent.filingDate?.[i] ?? "").trim(),
      reportDate: String(recent.reportDate?.[i] ?? "").trim() || null,
      primaryDocument: String(recent.primaryDocument?.[i] ?? "").trim(),
      filerName,
    });
  }

  refs.sort((a, b) => parseFilingDate(a.filingDate, b.filingDate));
  return refs.slice(0, Math.max(1, limit));
}

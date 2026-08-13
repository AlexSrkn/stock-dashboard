import type { SecCompanySubmissions } from "../submissions.js";
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

export interface DiscoverForm4Options {
  /** Max filings to return (newest first). */
  limit?: number;
  /**
   * Only include filings with filingDate strictly after this ISO date (YYYY-MM-DD).
   * When set, scans the recent submissions window and returns every matching Form 4
   * (capped by `limit`, default 120).
   */
  sinceDate?: string | null;
}

/**
 * Recent Form 4 / 4/A filings from submissions JSON, newest first.
 */
export function discoverForm4Filings(
  submissions: SecCompanySubmissions,
  limitOrOptions: number | DiscoverForm4Options = 50
): Form4FilingRef[] {
  const opts: DiscoverForm4Options =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions ?? {};
  const sinceDate = String(opts.sinceDate || "").trim() || null;
  const limit = Math.max(1, opts.limit ?? (sinceDate ? 120 : 50));

  const recent = submissions.filings?.recent;
  if (!recent?.form?.length) return [];

  const filerCik = formatSecCik(submissions.cik);
  const filerName = submissions.name ?? null;
  const cap = Math.min(recent.form.length, 1000);
  const refs: Form4FilingRef[] = [];

  for (let i = 0; i < cap; i++) {
    const form = String(recent.form[i] ?? "").trim();
    if (!FORM4_FORMS.has(form)) continue;

    const accessionNumber = String(recent.accessionNumber?.[i] ?? "").trim();
    if (!accessionNumber) continue;

    const filingDate = String(recent.filingDate?.[i] ?? "").trim();
    if (sinceDate && (!filingDate || filingDate <= sinceDate)) continue;

    refs.push({
      filerCik,
      accessionNumber,
      form,
      filingDate,
      reportDate: String(recent.reportDate?.[i] ?? "").trim() || null,
      primaryDocument: String(recent.primaryDocument?.[i] ?? "").trim(),
      filerName,
    });
  }

  refs.sort((a, b) => parseFilingDate(a.filingDate, b.filingDate));
  return refs.slice(0, limit);
}

import type { SecCompanySubmissions } from "../submissions.js";
import type { FinancialPeriodRow, SecCompanyFacts, SecFinancialFilingRow } from "./types.js";

const QUARTER_END_RE = /-(03-31|06-30|09-30|12-31)$/;

/** Foreign private issuers file 20-F/40-F instead of 10-K. */
export function isForeignAnnualFiler(submissions: SecCompanySubmissions): boolean {
  const recent = submissions.filings?.recent;
  if (!recent?.form?.length) return false;

  let hasForeignAnnual = false;
  let hasUsAnnual = false;
  const limit = Math.min(recent.form.length, 60);
  for (let i = 0; i < limit; i++) {
    const form = String(recent.form[i] ?? "").toUpperCase();
    if (form.startsWith("20-F") || form.startsWith("40-F")) hasForeignAnnual = true;
    if (form.startsWith("10-K")) hasUsAnnual = true;
  }
  return hasForeignAnnual && !hasUsAnnual;
}

export function usesIfrsCompanyFacts(companyFacts: SecCompanyFacts): boolean {
  const ifrs = companyFacts.facts?.["ifrs-full"];
  return Boolean(ifrs && Object.keys(ifrs).length > 0);
}

export function isForeignInterimFiler(
  submissions: SecCompanySubmissions,
  companyFacts: SecCompanyFacts
): boolean {
  return isForeignAnnualFiler(submissions) || usesIfrsCompanyFacts(companyFacts);
}

/** Interim results 6-K (skip corporate-action-only filings). */
export function isLikelyFinancialSixK(filing: SecFinancialFilingRow): boolean {
  const doc = String(filing.primaryDocument || "").toLowerCase();
  const desc = String(filing.description || "").toLowerCase();
  if (/result|interim|financial|earnings|half[- ]year|quarter/i.test(desc)) return true;
  if (/^\w+-\d{8}\.htm$/i.test(doc)) return true;
  const reportDate = filing.reportDate?.slice(0, 10);
  if (reportDate && QUARTER_END_RE.test(reportDate)) return true;
  return false;
}

export function shouldSupplementFromSixK(
  submissions: SecCompanySubmissions,
  companyFacts: SecCompanyFacts,
  quarterly: FinancialPeriodRow[],
  sixKFilings: SecFinancialFilingRow[]
): boolean {
  if (!isForeignInterimFiler(submissions, companyFacts)) return false;
  if (!sixKFilings.some(isLikelyFinancialSixK)) return false;

  const latestQuarterEnd = quarterly[0]?.end?.slice(0, 10);
  if (!latestQuarterEnd) return true;

  return sixKFilings.some((filing) => {
    if (!isLikelyFinancialSixK(filing)) return false;
    const reportDate = filing.reportDate?.slice(0, 10);
    if (reportDate && reportDate > latestQuarterEnd) return true;
    const filed = filing.filingDate?.slice(0, 10);
    const latestFiled = quarterly[0]?.filed?.slice(0, 10);
    return Boolean(filed && latestFiled && filed > latestFiled);
  });
}

export function rankFinancialSixKFilings(
  filings: SecFinancialFilingRow[]
): SecFinancialFilingRow[] {
  return [...filings]
    .filter(isLikelyFinancialSixK)
    .sort((a, b) => {
      const aReport = a.reportDate?.slice(0, 10) ?? "";
      const bReport = b.reportDate?.slice(0, 10) ?? "";
      if (aReport !== bReport) return bReport.localeCompare(aReport);
      return String(b.filingDate ?? "").localeCompare(String(a.filingDate ?? ""));
    });
}

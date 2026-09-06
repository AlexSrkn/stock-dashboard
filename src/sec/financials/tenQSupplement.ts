import type { FinancialPeriodRow, SecFinancialFilingRow } from "./types.js";

/** Pure US 10-Q (exclude foreign 6-K interims handled elsewhere). */
export function isUsTenQFiling(filing: SecFinancialFilingRow): boolean {
  const form = String(filing.form || "").toUpperCase();
  return form === "10-Q" || form === "10-Q/A";
}

/**
 * True when submissions list a 10-Q whose report period is newer than the
 * latest Company Facts quarterly row (XBRL companyfacts lag).
 */
export function shouldSupplementFromTenQ(
  quarterly: FinancialPeriodRow[],
  tenQFilings: SecFinancialFilingRow[]
): boolean {
  const candidates = tenQFilings.filter(isUsTenQFiling);
  if (!candidates.length) return false;

  const latestQuarterEnd = quarterly[0]?.end?.slice(0, 10);
  if (!latestQuarterEnd) return true;

  return candidates.some((filing) => {
    const reportDate = filing.reportDate?.slice(0, 10);
    if (reportDate && reportDate > latestQuarterEnd) return true;
    const filed = filing.filingDate?.slice(0, 10);
    const latestFiled = quarterly[0]?.filed?.slice(0, 10);
    return Boolean(filed && latestFiled && filed > latestFiled && !reportDate);
  });
}

export function rankTenQFilingsForSupplement(
  filings: SecFinancialFilingRow[]
): SecFinancialFilingRow[] {
  return [...filings].filter(isUsTenQFiling).sort((a, b) => {
    const aReport = a.reportDate?.slice(0, 10) ?? "";
    const bReport = b.reportDate?.slice(0, 10) ?? "";
    if (aReport !== bReport) return bReport.localeCompare(aReport);
    return String(b.filingDate ?? "").localeCompare(String(a.filingDate ?? ""));
  });
}

import { edgarFilingBaseUrl, formatSecCik } from "../http.js";
import type { SecCompanySubmissions } from "../submissions.js";
import type { SecFinancialFilingRow } from "./types.js";

function filingHref(cik: number | string, accessionNumber: string, primaryDocument: string): string {
  const acc = String(accessionNumber).trim();
  const doc = String(primaryDocument || "").trim();
  if (!acc) return "";
  if (!doc) {
    const bare = formatSecCik(cik).replace(/^0+/, "") || "0";
    const enc = new URLSearchParams({
      action: "view",
      cik: bare,
      accession_number: acc,
    });
    return `https://www.sec.gov/cgi-bin/viewer?${enc}`;
  }
  const docPath = doc
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${edgarFilingBaseUrl(cik, acc)}/${docPath}`;
}

function matchesFormGroup(form: string, group: "10-K" | "10-Q" | "8-K"): boolean {
  const f = String(form || "").toUpperCase();
  if (group === "10-K") return f === "10-K" || f === "10-K/A";
  if (group === "10-Q") return f === "10-Q" || f === "10-Q/A";
  return f === "8-K" || f === "8-K/A";
}

function mapFilingRow(
  submissions: SecCompanySubmissions,
  index: number,
  cik: number | string
): SecFinancialFilingRow {
  const recent = submissions.filings.recent;
  const accessionNumber = String(recent.accessionNumber?.[index] ?? "");
  const primaryDocument = String(recent.primaryDocument?.[index] ?? "");
  return {
    form: String(recent.form?.[index] ?? ""),
    filingDate: String(recent.filingDate?.[index] ?? ""),
    reportDate: recent.reportDate?.[index] ? String(recent.reportDate[index]) : null,
    accessionNumber,
    primaryDocument,
    description: String(recent.primaryDocDescription?.[index] ?? ""),
    items: recent.items?.[index] ? String(recent.items[index]) : null,
    isXBRL: Number(recent.isXBRL?.[index] ?? 0) === 1,
    href: filingHref(cik, accessionNumber, primaryDocument),
  };
}

export interface DiscoverFinancialFilingsOptions {
  annualLimit?: number;
  quarterlyLimit?: number;
  currentLimit?: number;
}

export function discoverFinancialFilings(
  submissions: SecCompanySubmissions,
  cik: number | string,
  options: DiscoverFinancialFilingsOptions = {}
): {
  "10-K": SecFinancialFilingRow[];
  "10-Q": SecFinancialFilingRow[];
  "8-K": SecFinancialFilingRow[];
} {
  const annualLimit = Math.min(40, Math.max(1, options.annualLimit ?? 8));
  const quarterlyLimit = Math.min(40, Math.max(1, options.quarterlyLimit ?? 12));
  const currentLimit = Math.min(40, Math.max(1, options.currentLimit ?? 20));

  const recent = submissions.filings?.recent;
  const out = {
    "10-K": [] as SecFinancialFilingRow[],
    "10-Q": [] as SecFinancialFilingRow[],
    "8-K": [] as SecFinancialFilingRow[],
  };
  if (!recent?.form?.length) return out;

  for (let i = 0; i < recent.form.length; i++) {
    const form = String(recent.form[i] ?? "");
    const row = mapFilingRow(submissions, i, cik);
    if (matchesFormGroup(form, "10-K")) {
      if (out["10-K"].length < annualLimit) out["10-K"].push(row);
    } else if (matchesFormGroup(form, "10-Q")) {
      if (out["10-Q"].length < quarterlyLimit) out["10-Q"].push(row);
    } else if (matchesFormGroup(form, "8-K")) {
      if (out["8-K"].length < currentLimit) out["8-K"].push(row);
    }
  }

  return out;
}

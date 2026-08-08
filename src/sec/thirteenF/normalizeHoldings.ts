import { createHash } from "node:crypto";
import type { Parsed13FHolding } from "./parse13F.js";
import type {
  Holding,
  HoldingDbInsert,
  Sec13FFilingRef,
  Sec13FHoldingInsert,
  Sec13FInfoTableRow,
} from "./types.js";
import {
  mapInfoTableRowToHoldingFields,
} from "./holdingClassification.js";

export { isCommonStockSharePosition as isReportableCommonStockHolding } from "./holdingClassification.js";

const MISSING_STRINGS = new Set(["", "-", "—", "n/a", "na", "none", "null", "undefined"]);

/** Derive `YYYY-Qn` from a report period or filing date (`YYYY-MM-DD`). */
export function toQuarter(date: string | null | undefined): string {
  const raw = String(date ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})/);
  if (!match) return "";
  const year = match[1];
  const month = Number(match[2]);
  if (!Number.isFinite(month) || month < 1 || month > 12) return "";
  return `${year}-Q${Math.ceil(month / 3)}`;
}

/** Clean string for required text columns (trim, collapse whitespace). */
export function normalizeRequiredString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  const s = String(value).replace(/\s+/g, " ").trim();
  if (MISSING_STRINGS.has(s.toLowerCase())) return fallback;
  return s || fallback;
}

/** Clean optional text; missing → `null`. */
export function normalizeOptionalString(value: unknown, maxLength?: number): string | null {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  if (!s || MISSING_STRINGS.has(s.toLowerCase())) return null;
  if (maxLength != null && s.length > maxLength) return s.slice(0, maxLength);
  return s;
}

/** Parse SEC numeric fields (commas, whitespace). */
export function normalizeNumber(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || MISSING_STRINGS.has(text.toLowerCase())) return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

/** Optional numeric; missing → `null`. */
export function normalizeOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || MISSING_STRINGS.has(text.toLowerCase())) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** CUSIP: uppercase alphanumeric, 9 chars (SEC XML often drops leading zeros). */
export function normalizeCusip(value: unknown): string {
  const raw = normalizeRequiredString(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  if (raw.length <= 9) return raw.padStart(9, "0");
  return raw.slice(0, 9);
}

/** ISO date `YYYY-MM-DD` for Postgres `DATE`. */
export function normalizeDate(value: unknown): string | null {
  const s = normalizeRequiredString(value);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (us) return `${us[1]}-${us[2]}-${us[3]}`;
  return null;
}

export function normalizePutCall(value: unknown): string | null {
  const s = normalizeOptionalString(value, 8);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "put") return "Put";
  if (lower === "call") return "Call";
  return s;
}

export function normalizeSharesType(value: unknown): string | null {
  const s = normalizeOptionalString(value, 8)?.toUpperCase() ?? null;
  if (s === "SH" || s === "PRN") return s;
  return s;
}

export function normalizeFundName(value: unknown): string {
  return normalizeRequiredString(value, "Unknown fund");
}

export function buildHoldingRowHash(parts: {
  accessionNumber: string;
  cusip: string;
  titleOfClass: string;
  shares: number;
  securityType: string;
  optionType: string | null;
}): string {
  const key = [
    parts.accessionNumber,
    parts.cusip,
    parts.titleOfClass,
    parts.securityType,
    parts.optionType ?? "",
    String(parts.shares),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export interface NormalizeHoldingsContext {
  fundName?: string | null;
  filerCik: string;
  accessionNumber: string;
  filingDate: string;
  reportPeriod?: string | null;
}

/** Fully normalized holding (app + DB-ready). */
export interface NormalizedHoldingRecord extends Holding {
  filerCik: string;
  accessionNumber: string;
  putCall: string | null;
  sharesType: string | null;
  securityType: string;
  optionType: string | null;
  discretion: string | null;
  titleOfClass: string;
  ticker: string | null;
  rowHash: string;
}

function normalizeInfoTableRow(
  row: Sec13FInfoTableRow,
  ctx: NormalizeHoldingsContext
): NormalizedHoldingRecord {
  const fundName = normalizeFundName(ctx.fundName);
  const issuer = normalizeRequiredString(row.nameOfIssuer);
  const cusip = normalizeCusip(row.cusip);
  const shares = normalizeNumber(row.sharesOrPrincipalAmount, 0);
  const value = Math.round(normalizeNumber(row.valueUsdThousands, 0));
  const filingDate = normalizeDate(ctx.filingDate) ?? normalizeRequiredString(ctx.filingDate);
  const quarter = toQuarter(ctx.reportPeriod ?? ctx.filingDate);
  const { securityType, optionType, discretion, titleOfClass } =
    mapInfoTableRowToHoldingFields(row);
  const putCall = optionType;
  const sharesType = securityType === "PRN" ? "PRN" : "SH";
  const filerCik = normalizeRequiredString(ctx.filerCik).padStart(10, "0");
  const accessionNumber = normalizeRequiredString(ctx.accessionNumber);

  const rowHash = buildHoldingRowHash({
    accessionNumber,
    cusip,
    titleOfClass,
    shares,
    securityType,
    optionType,
  });

  return {
    fundName,
    issuer,
    cusip,
    shares,
    value,
    filingDate,
    quarter,
    filerCik,
    accessionNumber,
    putCall,
    sharesType,
    securityType,
    optionType,
    discretion,
    titleOfClass,
    ticker: null,
    rowHash,
  };
}

function normalizeParsedRow(
  row: Parsed13FHolding,
  ctx: NormalizeHoldingsContext
): NormalizedHoldingRecord {
  const info: Sec13FInfoTableRow = {
    nameOfIssuer: row.issuer,
    titleOfClass: "",
    cusip: row.cusip,
    figi: null,
    valueUsdThousands: row.value,
    sharesOrPrincipalAmount: row.shares,
    sharesOrPrincipalType: row.sharesType,
    investmentDiscretion: null,
    putCall: row.putCall,
    otherManager: null,
    votingSole: null,
    votingShared: null,
    votingNone: null,
  };
  return normalizeInfoTableRow(info, ctx);
}

/**
 * Normalize parsed 13F XML rows into clean types for app use and DB insertion.
 */
export function normalizeHoldings(
  parsed: Parsed13FHolding[],
  context: NormalizeHoldingsContext
): NormalizedHoldingRecord[] {
  return parsed
    .map((row) => normalizeParsedRow(row, context))
    .filter((row) => row.cusip.length > 0 || row.issuer.length > 0);
}

/**
 * Normalize extended info-table rows — keeps stock, puts, calls, and debt as separate rows.
 */
export function normalizeHoldingsFromInfoRows(
  rows: Sec13FInfoTableRow[],
  context: NormalizeHoldingsContext
): NormalizedHoldingRecord[] {
  return rows
    .map((row) => normalizeInfoTableRow(row, context))
    .filter((row) => row.cusip.length > 0 || row.issuer.length > 0);
}

/** Map to {@link Holding} (public API shape). */
export function toHoldings(records: NormalizedHoldingRecord[]): Holding[] {
  return records.map(({ fundName, issuer, cusip, shares, value, filingDate, quarter }) => ({
    fundName,
    issuer,
    cusip,
    shares,
    value,
    filingDate,
    quarter,
  }));
}

/** Map to snake_case rows aligned with {@link Holding} + filing metadata. */
export function toHoldingDbInserts(records: NormalizedHoldingRecord[]): HoldingDbInsert[] {
  return records.map((r) => ({
    filer_cik: r.filerCik,
    accession_number: r.accessionNumber,
    fund_name: r.fundName,
    issuer: r.issuer,
    cusip: r.cusip,
    ticker: r.ticker,
    shares: r.shares,
    value: r.value,
    value_usd_thousands: r.value,
    filing_date: r.filingDate,
    quarter: r.quarter,
    put_call: r.putCall,
    shares_type: r.sharesType,
    security_type: r.securityType,
    option_type: r.optionType,
    discretion: r.discretion,
    title_of_class: r.titleOfClass,
    row_hash: r.rowHash,
  }));
}

/** Map to existing `sec_13f_holding` insert shape (extended columns). */
export function toSec13FHoldingInserts(
  records: NormalizedHoldingRecord[],
  rows: Sec13FInfoTableRow[]
): Sec13FHoldingInsert[] {
  return records.map((rec, i) => {
    const row = rows[i];
    return {
      filer_cik: rec.filerCik,
      accession_number: rec.accessionNumber,
      name_of_issuer: rec.issuer,
      title_of_class: normalizeRequiredString(row?.titleOfClass),
      cusip: rec.cusip,
      figi: normalizeOptionalString(row?.figi, 12),
      value_usd_thousands: rec.value,
      shares_or_principal_amount: rec.shares,
      shares_or_principal_type: rec.sharesType,
      investment_discretion: normalizeOptionalString(row?.investmentDiscretion, 8),
      put_call: rec.putCall,
      other_manager: normalizeOptionalString(row?.otherManager, 32),
      voting_sole: normalizeOptionalNumber(row?.votingSole),
      voting_shared: normalizeOptionalNumber(row?.votingShared),
      voting_none: normalizeOptionalNumber(row?.votingNone),
      row_hash: rec.rowHash,
    };
  });
}

export function normalizeHoldingsFromFiling(
  filing: Sec13FFilingRef,
  parsed: Parsed13FHolding[]
): NormalizedHoldingRecord[] {
  return normalizeHoldings(parsed, {
    fundName: filing.filerName,
    filerCik: filing.filerCik,
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    reportPeriod: filing.reportDate,
  });
}

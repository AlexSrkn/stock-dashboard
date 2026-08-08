import type { Sec13FInfoTableRow } from "./types.js";

export function normalizeOptionType(value: unknown): string | null {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "put") return "Put";
  if (s === "call") return "Call";
  return null;
}

export function normalizeSecurityType(value: unknown): string {
  const s = String(value ?? "")
    .trim()
    .toUpperCase();
  if (s === "PRN") return "PRN";
  return "SH";
}

/** Common-stock share lines only (excludes puts, calls, and debt). */
export function isCommonStockSharePosition(holding: {
  optionType?: string | null;
  securityType?: string | null;
  putCall?: string | null;
  sharesType?: string | null;
}): boolean {
  const option = holding.optionType ?? holding.putCall;
  if (option) return false;
  const sec = (holding.securityType ?? holding.sharesType ?? "SH").toUpperCase();
  return sec === "SH";
}

export function mapInfoTableRowToHoldingFields(row: Sec13FInfoTableRow): {
  securityType: string;
  optionType: string | null;
  discretion: string | null;
  titleOfClass: string;
} {
  return {
    securityType: normalizeSecurityType(row.sharesOrPrincipalType),
    optionType: normalizeOptionType(row.putCall),
    discretion: row.investmentDiscretion?.trim() || null,
    titleOfClass: row.titleOfClass?.trim() || "",
  };
}

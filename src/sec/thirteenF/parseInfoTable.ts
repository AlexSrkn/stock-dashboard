/**
 * Extended 13F row types used by normalization / PostgreSQL pipeline.
 * Core XML parsing lives in `parse13F.ts`.
 */
import { parse13FEntries } from "./parse13F.js";
import type { Sec13FInfoTableRow } from "./types.js";

function readText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function readNumber(value: unknown): number | null {
  const text = readText(value);
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseVotingAuthority(raw: unknown): {
  sole: number | null;
  shared: number | null;
  none: number | null;
} {
  if (raw == null || typeof raw !== "object") {
    return { sole: null, shared: null, none: null };
  }
  const v = raw as Record<string, unknown>;
  return {
    sole: readNumber(v.Sole),
    shared: readNumber(v.Shared),
    none: readNumber(v.None),
  };
}

function toInfoTableRow(entry: Record<string, unknown>): Sec13FInfoTableRow | null {
  const nameOfIssuer = readText(entry.nameOfIssuer);
  const cusip = readText(entry.cusip).toUpperCase();
  if (!nameOfIssuer && !cusip) return null;

  const sharesBlock = entry.shrsOrPrnAmt;
  let sharesOrPrincipalAmount = 0;
  let sharesOrPrincipalType: string | null = null;
  if (sharesBlock != null && typeof sharesBlock === "object") {
    const b = sharesBlock as Record<string, unknown>;
    sharesOrPrincipalAmount = readNumber(b.sshPrnamt) ?? 0;
    sharesOrPrincipalType = readText(b.sshPrnamtType) || null;
  } else {
    sharesOrPrincipalAmount = readNumber(sharesBlock) ?? 0;
  }

  const voting = parseVotingAuthority(entry.votingAuthority);

  return {
    nameOfIssuer,
    titleOfClass: readText(entry.titleOfClass),
    cusip,
    figi: readText(entry.figi) || null,
    valueUsdThousands: readNumber(entry.value) ?? 0,
    sharesOrPrincipalAmount,
    sharesOrPrincipalType,
    investmentDiscretion: readText(entry.investmentDiscretion) || null,
    putCall: readText(entry.putCall) || null,
    otherManager: readText(entry.otherManager) || null,
    votingSole: voting.sole,
    votingShared: voting.shared,
    votingNone: voting.none,
  };
}

/**
 * Parse 13F XML into extended rows (includes voting, discretion, FIGI).
 * @see parse13F for core issuer/cusip/shares/value/putCall parsing.
 */
export function parse13FInformationTableXml(xml: string): Sec13FInfoTableRow[] {
  const { entries } = parse13FEntries(xml);
  const rows: Sec13FInfoTableRow[] = [];
  for (const entry of entries) {
    const row = toInfoTableRow(entry);
    if (row) rows.push(row);
  }
  return rows;
}

export { parse13F, parse13FEntries, Parse13FError, type Parsed13FHolding } from "./parse13F.js";

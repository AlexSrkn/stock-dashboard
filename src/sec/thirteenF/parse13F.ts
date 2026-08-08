import { XMLParser } from "fast-xml-parser";

/** Normalized 13F information table holding (core fields). */
export interface Parsed13FHolding {
  /** Issuer name (`nameOfIssuer`). */
  issuer: string;
  /** CUSIP (9 chars, uppercased). */
  cusip: string;
  /** Share or principal amount (`sshPrnamt`). */
  shares: number;
  /** `SH` or `PRN` when present. */
  sharesType: string | null;
  /** Market value in thousands of USD (SEC 13F convention). */
  value: number;
  /** Put / Call indicator, or null when not applicable. */
  putCall: string | null;
}

export type Parse13FErrorCode = "EMPTY_XML" | "INVALID_XML" | "NO_HOLDINGS";

export class Parse13FError extends Error {
  readonly code: Parse13FErrorCode;

  constructor(message: string, code: Parse13FErrorCode) {
    super(message);
    this.name = "Parse13FError";
    this.code = code;
  }
}

const infoTableParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
  isArray: (tagName) => tagName === "infoTable",
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && value !== null && "#text" in value) {
    return String((value as Record<string, unknown>)["#text"] ?? "").trim();
  }
  return "";
}

function readNumber(value: unknown): number | null {
  const text = readText(value);
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseSharesBlock(raw: unknown): { shares: number; sharesType: string | null } {
  if (raw == null || typeof raw !== "object") {
    return { shares: readNumber(raw) ?? 0, sharesType: null };
  }
  const block = raw as Record<string, unknown>;
  return {
    shares: readNumber(block.sshPrnamt) ?? 0,
    sharesType: readText(block.sshPrnamtType) || null,
  };
}

function parseInfoTableEntry(entry: Record<string, unknown>): Parsed13FHolding | null {
  const issuer = readText(entry.nameOfIssuer);
  const cusip = readText(entry.cusip).toUpperCase();
  if (!issuer && !cusip) return null;

  const { shares, sharesType } = parseSharesBlock(entry.shrsOrPrnAmt);
  const value = readNumber(entry.value) ?? 0;
  const putCall = readText(entry.putCall) || null;

  return {
    issuer,
    cusip,
    shares,
    sharesType,
    value,
    putCall,
  };
}

function extractInfoTableRoot(parsed: Record<string, unknown>): Record<string, unknown> {
  const root = parsed.informationTable;
  if (root != null && typeof root === "object") {
    return root as Record<string, unknown>;
  }
  return parsed;
}

function assertInformationTableXml(xml: string): void {
  const trimmed = xml.trim();
  if (!trimmed) {
    throw new Parse13FError("XML input is empty", "EMPTY_XML");
  }
  const lower = trimmed.slice(0, 8000).toLowerCase();
  if (!lower.includes("<informationtable") && !lower.includes(":informationtable")) {
    throw new Parse13FError("Input does not appear to be a 13F information table", "INVALID_XML");
  }
}

export interface Parse13FParseResult {
  holdings: Parsed13FHolding[];
  /** Raw `infoTable` objects from XML (for extended field mapping). */
  entries: Record<string, unknown>[];
}

export function parse13FEntries(xml: string): Parse13FParseResult {
  assertInformationTableXml(xml);

  let parsed: Record<string, unknown>;
  try {
    parsed = infoTableParser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new Parse13FError(
      `XML parse failed: ${err instanceof Error ? err.message : String(err)}`,
      "INVALID_XML"
    );
  }

  const root = extractInfoTableRoot(parsed);
  const entries = asArray<Record<string, unknown>>(
    root.infoTable as Record<string, unknown> | Record<string, unknown>[] | undefined
  );

  const holdings: Parsed13FHolding[] = [];
  for (const entry of entries) {
    const row = parseInfoTableEntry(entry);
    if (row) holdings.push(row);
  }

  if (!holdings.length) {
    throw new Parse13FError("No holdings found in information table", "NO_HOLDINGS");
  }

  return { holdings, entries };
}

/**
 * Parse SEC 13F information table XML into a normalized holdings array.
 * Uses fast-xml-parser; does not perform network I/O.
 */
export function parse13F(xml: string): Parsed13FHolding[] {
  return parse13FEntries(xml).holdings;
}

/** Alias for {@link parse13F}. */
export const parse13FInformationTable = parse13F;

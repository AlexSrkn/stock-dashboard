import { XMLParser } from "fast-xml-parser";
import { classifyTransactionSignal } from "./transactionCodes.js";
import type { ParsedForm4Document, ParsedForm4Transaction } from "./types.js";

const form4Parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  isArray: (tagName) =>
    [
      "reportingOwner",
      "nonDerivativeTransaction",
      "derivativeTransaction",
      "nonDerivativeHolding",
      "derivativeHolding",
    ].includes(tagName),
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if ("value" in o) return readText(o.value);
    if ("#text" in o) return String(o["#text"] ?? "").trim();
  }
  return "";
}

function readNumber(value: unknown): number | null {
  const text = readText(value);
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(value: unknown): string | null {
  const s = readText(value);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return null;
}

function buildInsiderTitle(rel: Record<string, unknown> | undefined): string | null {
  if (!rel) return null;
  const parts: string[] = [];
  const officerTitle = readText(rel.officerTitle);
  if (officerTitle) parts.push(officerTitle);
  if (readText(rel.isDirector) === "1" || readText(rel.isDirector).toLowerCase() === "true") {
    parts.push("Director");
  }
  if (readText(rel.isOfficer) === "1" || readText(rel.isOfficer).toLowerCase() === "true") {
    if (!officerTitle) parts.push("Officer");
  }
  if (readText(rel.isTenPercentOwner) === "1") parts.push("10% Owner");
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

function readInsiderName(owner: Record<string, unknown>): string {
  const id = owner.reportingOwnerId as Record<string, unknown> | undefined;
  const name = readText(id?.rptOwnerName);
  if (name) return name;
  return readText(owner.rptOwnerName) || "Unknown insider";
}

function parseTransactionRow(
  tx: Record<string, unknown>,
  ctx: {
    insiderName: string;
    insiderTitle: string | null;
    filingDate: string | null;
    isDerivative: boolean;
  }
): ParsedForm4Transaction | null {
  const coding = (tx.transactionCoding ?? tx.transactionCode) as Record<string, unknown> | undefined;
  const code = readText(coding?.transactionCode ?? tx.transactionCode).toUpperCase();
  if (!code) return null;

  const amounts = tx.transactionAmounts as Record<string, unknown> | undefined;
  const shares = readNumber(amounts?.transactionShares ?? tx.transactionShares);
  const price = readNumber(amounts?.transactionPricePerShare ?? tx.transactionPricePerShare);
  const adCode = readText(
    amounts?.transactionAcquiredDisposedCode ?? tx.transactionAcquiredDisposedCode
  ).toUpperCase();

  const txDate = normalizeDate(tx.transactionDate);
  const securityTitle = readText(tx.securityTitle) || null;
  const ownership = tx.ownershipNature as Record<string, unknown> | undefined;
  const ownershipNature =
    readText(ownership?.directOrIndirectOwnership ?? tx.directOrIndirectOwnership).toUpperCase() ||
    null;

  let value = shares != null && price != null ? Math.round(shares * price * 100) / 100 : null;
  if (value == null && shares != null && price == null) value = null;

  const rowKey = [
    ctx.insiderName,
    code,
    txDate ?? "",
    String(shares ?? ""),
    String(price ?? ""),
    adCode,
    securityTitle ?? "",
    ctx.isDerivative ? "D" : "N",
  ].join("|");

  return {
    insiderName: ctx.insiderName,
    insiderTitle: ctx.insiderTitle,
    filingDate: ctx.filingDate,
    transactionDate: txDate,
    transactionCode: code,
    acquisitionDisposition: adCode || null,
    shares,
    pricePerShare: price,
    transactionValue: value,
    ownershipNature,
    securityTitle,
    isDerivative: ctx.isDerivative,
    isHighSignal: classifyTransactionSignal(code),
    rowKey,
  };
}

function extractTransactionsForOwner(
  doc: Record<string, unknown>,
  owner: Record<string, unknown>,
  filingDate: string | null
): ParsedForm4Transaction[] {
  const insiderName = readInsiderName(owner);
  const rel = owner.reportingOwnerRelationship as Record<string, unknown> | undefined;
  const insiderTitle = buildInsiderTitle(rel);
  const ctx = { insiderName, insiderTitle, filingDate, isDerivative: false };

  const out: ParsedForm4Transaction[] = [];
  const nonDeriv = doc.nonDerivativeTable as Record<string, unknown> | undefined;
  for (const tx of asArray(nonDeriv?.nonDerivativeTransaction)) {
    if (typeof tx !== "object" || tx === null) continue;
    const row = parseTransactionRow(tx as Record<string, unknown>, { ...ctx, isDerivative: false });
    if (row) out.push(row);
  }

  const deriv = doc.derivativeTable as Record<string, unknown> | undefined;
  for (const tx of asArray(deriv?.derivativeTransaction)) {
    if (typeof tx !== "object" || tx === null) continue;
    const row = parseTransactionRow(tx as Record<string, unknown>, { ...ctx, isDerivative: true });
    if (row) out.push(row);
  }

  return out;
}

export function parseForm4Xml(xml: string, filingDate: string | null = null): ParsedForm4Document {
  if (!xml?.trim()) {
    return { issuerCik: null, issuerTicker: null, issuerName: null, periodOfReport: null, transactions: [] };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = form4Parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Invalid Form 4 XML: ${e instanceof Error ? e.message : String(e)}`);
  }

  const root =
    (parsed.ownershipDocument as Record<string, unknown> | undefined) ??
    (parsed.ownershipdocument as Record<string, unknown> | undefined) ??
    parsed;

  const issuer = root.issuer as Record<string, unknown> | undefined;
  const issuerCik = readText(issuer?.issuerCik) || null;
  const issuerTicker = readText(issuer?.issuerTradingSymbol).toUpperCase() || null;
  const issuerName = readText(issuer?.issuerName) || null;
  const periodOfReport = normalizeDate(root.periodOfReport);

  const effectiveFilingDate = filingDate ?? normalizeDate(root.periodOfReport);
  const transactions: ParsedForm4Transaction[] = [];

  const owners = asArray(root.reportingOwner);
  if (owners.length) {
    for (const owner of owners) {
      if (typeof owner !== "object" || owner === null) continue;
      transactions.push(
        ...extractTransactionsForOwner(root, owner as Record<string, unknown>, effectiveFilingDate)
      );
    }
  } else {
    transactions.push(...extractTransactionsForOwner(root, root, effectiveFilingDate));
  }

  return {
    issuerCik,
    issuerTicker,
    issuerName,
    periodOfReport,
    transactions,
  };
}

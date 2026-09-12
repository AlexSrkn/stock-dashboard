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
      "footnote",
      "footnoteId",
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

function extractFootnotes(root: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const block = root.footnotes as Record<string, unknown> | undefined;
  for (const fn of asArray(block?.footnote)) {
    if (typeof fn !== "object" || fn === null) continue;
    const o = fn as Record<string, unknown>;
    const id = String(o["@_id"] ?? o.id ?? "").trim();
    if (!id) continue;
    const text = readText(o).replace(/\s+/g, " ").trim();
    if (text) out.set(id, text);
  }
  return out;
}

function readFootnoteIds(value: unknown): string[] {
  if (value == null || typeof value !== "object") return [];
  const o = value as Record<string, unknown>;
  const ids: string[] = [];
  for (const fn of asArray(o.footnoteId)) {
    if (typeof fn === "string") {
      if (fn.trim()) ids.push(fn.trim());
      continue;
    }
    if (typeof fn !== "object" || fn === null) continue;
    const id = String((fn as Record<string, unknown>)["@_id"] ?? (fn as Record<string, unknown>).id ?? "").trim();
    if (id) ids.push(id);
  }
  return ids;
}

/** Pull a usable $/share figure out of Form 4 footnote prose. */
export function parsePriceFromFootnoteText(text: string): number | null {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const range = t.match(
    /prices?\s+ranging\s+from\s+\$?\s*([\d,]+(?:\.\d+)?)\s+to\s+\$?\s*([\d,]+(?:\.\d+)?)/i
  );
  if (range) {
    const a = Number(range[1]!.replace(/,/g, ""));
    const b = Number(range[2]!.replace(/,/g, ""));
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return Math.round(((a + b) / 2) * 1_000_000) / 1_000_000;
    }
  }

  const patterns = [
    /(?:purchase price|sale price|price paid|priced? at|weighted average price(?:\s+of)?|was)\s*[^\d$]{0,48}\$\s*([\d,]+(?:\.\d+)?)/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s+per share/i,
    /(?:was|at|of)\s+\$\s*([\d,]+(?:\.\d+)?)\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const n = Number(m[1]!.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function resolvePriceFromFootnotes(
  priceNode: unknown,
  footnotes: Map<string, string>
): number | null {
  for (const id of readFootnoteIds(priceNode)) {
    const text = footnotes.get(id);
    if (!text) continue;
    const price = parsePriceFromFootnoteText(text);
    if (price != null) return price;
  }
  return null;
}

function parseTransactionRow(
  tx: Record<string, unknown>,
  ctx: {
    insiderName: string;
    insiderTitle: string | null;
    filingDate: string | null;
    isDerivative: boolean;
    footnotes: Map<string, string>;
  }
): ParsedForm4Transaction | null {
  const coding = (tx.transactionCoding ?? tx.transactionCode) as Record<string, unknown> | undefined;
  const code = readText(coding?.transactionCode ?? tx.transactionCode).toUpperCase();
  if (!code) return null;

  const amounts = tx.transactionAmounts as Record<string, unknown> | undefined;
  const shares = readNumber(amounts?.transactionShares ?? tx.transactionShares);
  const priceNode = amounts?.transactionPricePerShare ?? tx.transactionPricePerShare;
  // Keep null in rowKey when price lived only in a footnote — matches already-ingested hashes.
  const priceFromValue = readNumber(priceNode);
  const price =
    priceFromValue != null && priceFromValue > 0
      ? priceFromValue
      : resolvePriceFromFootnotes(priceNode, ctx.footnotes);
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
    String(priceFromValue ?? ""),
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
  filingDate: string | null,
  footnotes: Map<string, string>
): ParsedForm4Transaction[] {
  const insiderName = readInsiderName(owner);
  const rel = owner.reportingOwnerRelationship as Record<string, unknown> | undefined;
  const insiderTitle = buildInsiderTitle(rel);
  const ctx = { insiderName, insiderTitle, filingDate, isDerivative: false, footnotes };

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
  const footnotes = extractFootnotes(root);

  const effectiveFilingDate = filingDate ?? normalizeDate(root.periodOfReport);
  const transactions: ParsedForm4Transaction[] = [];

  const owners = asArray(root.reportingOwner);
  if (owners.length) {
    for (const owner of owners) {
      if (typeof owner !== "object" || owner === null) continue;
      transactions.push(
        ...extractTransactionsForOwner(
          root,
          owner as Record<string, unknown>,
          effectiveFilingDate,
          footnotes
        )
      );
    }
  } else {
    transactions.push(...extractTransactionsForOwner(root, root, effectiveFilingDate, footnotes));
  }

  return {
    issuerCik,
    issuerTicker,
    issuerName,
    periodOfReport,
    transactions,
  };
}

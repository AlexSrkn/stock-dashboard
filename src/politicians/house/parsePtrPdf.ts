import { PDFParse } from "pdf-parse";
import type { HouseFilingIndexEntry } from "../types.js";
import type { PoliticianTrade } from "../types.js";
import { housePtrPdfUrl } from "./urls.js";
import { housePoliticianName, parseHouseStateDistrict } from "./parseIndex.js";
import { mapTransactionCategory, parseAmountRange } from "../normalize.js";

const TXN_RE =
  /(?:\(([A-Z0-9./]+)\)\s*)?\[([A-Z]+)\]\s*((?:P|S|E)(?:\s*\([^)]*\))?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\$[\d,]+(?:\s*-\s*(?:\n|\r)?\$[\d,]+)?)/gi;

function cleanPdfText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function extractHeader(text: string): {
  politicianName: string;
  state?: string;
  district?: string;
  filingId?: string;
} {
  const nameMatch = text.match(/Name:\s+(.+?)(?:\n|Status:)/i);
  const stateMatch = text.match(/State\/District:\s*([A-Z]{2}\d{0,2})/i);
  const filingIdMatch = text.match(/Filing ID #(\d+)/i);
  const { state, district } = parseHouseStateDistrict(stateMatch?.[1] ?? "");
  return {
    politicianName: nameMatch?.[1]?.trim() || "Unknown",
    state,
    district,
    filingId: filingIdMatch?.[1],
  };
}

function stripOwnerPrefix(line: string): string {
  return line.replace(/^(SP|JT|DC|Self)\s+/i, "").trim();
}

function assetNameBefore(text: string, startIdx: number): string {
  const slice = text.slice(Math.max(0, startIdx - 260), startIdx);
  const lines = slice
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const collected: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let line = lines[i];
    if (/^(ID|Owner|Asset|Transaction|Type|Date|Notification|Amount|Cap\.|Gains)\b/i.test(line)) {
      break;
    }
    if (/filing status|description:/i.test(line)) break;
    if (/^F\s+S:/i.test(line)) break;
    if (/^S\s+O:/i.test(line)) break;
    if (/^(P|S|E)(\s*\(|$)/.test(line)) break;
    if (/^\d{2}\/\d{2}\/\d{4}/.test(line)) break;

    const withoutOwner = stripOwnerPrefix(line);
    if (/^(SP|JT|DC|Self)\b/i.test(line) && withoutOwner) {
      collected.unshift(withoutOwner);
      break;
    }
    if (/^(SP|JT|DC|Self)\b/i.test(line)) break;

    collected.unshift(line);
    if (collected.length >= 4) break;
  }
  return collected.join(" ").replace(/\s+/g, " ").trim();
}

function ownerBefore(text: string, startIdx: number): string | undefined {
  const slice = text.slice(Math.max(0, startIdx - 120), startIdx);
  const m = slice.match(/(?:^|\n)\s*(SP|JT|DC|Self)\s+[^\n]*$/i);
  return m?.[1];
}

function ptrFootnotesAfter(text: string, startIdx: number, endIdx: number) {
  const slice = text.slice(endIdx, Math.min(text.length, endIdx + 1200));
  const nextTxn = slice.search(/(?:\([A-Z0-9./]+\)\s*)?\[[A-Z]+\]\s*(?:P|S|E)/i);
  const block = nextTxn > 0 ? slice.slice(0, nextTxn) : slice.split(/\* For the complete list/i)[0] ?? slice;

  const filingStatus = block.match(/F\s+S:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const ownerDetail = block.match(/S\s+O:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const descRaw =
    block.match(/D\s*:\s*([\s\S]*?)(?=\nF\s+S:|\nS\s+O:|\nI\s+NVOVLEMENT|\n\* For the complete|$)/i)?.[1] ??
    block.match(/Description:\s*([\s\S]*?)(?=\nF\s+S:|\nS\s+O:|\nI\s+NVOVLEMENT|\n\* For the complete|$)/i)?.[1];
  const description = descRaw?.replace(/\s+/g, " ").trim() || null;
  const capMatch = block.match(/Cap\.?\s*Gains[^?]*\?\s*(Yes|No)/i);
  const capitalGainsOver200 = capMatch ? capMatch[1].toLowerCase() === "yes" : null;

  return { filingStatus, ownerDetail, description, capitalGainsOver200 };
}

function isTickerLike(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!v || v.length > 10) return false;
  if (/^\d{5,}$/.test(v)) return false;
  return /^[A-Z][A-Z0-9./-]*$/.test(v);
}

export async function parseHousePtrPdfBuffer(
  pdfBuffer: Buffer,
  filing: HouseFilingIndexEntry
): Promise<PoliticianTrade[]> {
  const parser = new PDFParse({ data: pdfBuffer });
  const textResult = await parser.getText();
  await parser.destroy();

  const text = cleanPdfText(textResult.text);
  const header = extractHeader(text);
  const politicianName = header.politicianName || housePoliticianName(filing);
  const { state, district } = parseHouseStateDistrict(filing.stateDst);
  const filingId = header.filingId || filing.docId;
  const sourceUrl = housePtrPdfUrl(filing.year, filing.docId);
  const trades: PoliticianTrade[] = [];

  for (const match of text.matchAll(TXN_RE)) {
    const rawTicker = match[1]?.trim() ?? "";
    const assetType = match[2]?.trim() ?? null;
    const transactionType = match[3]?.trim() ?? "";
    if (!/^(P|S|E)(\s*\([^)]*\))?$/i.test(transactionType)) continue;
    const transactionDate = match[4] ?? null;
    const notificationDate = match[5] ?? null;
    const amountRange = match[6]?.replace(/\s+/g, " ").trim() ?? null;
    const idx = match.index ?? 0;
    const endIdx = idx + match[0].length;
    const assetName = assetNameBefore(text, idx) || rawTicker;
    if (/filing status|involvement|description:/i.test(assetName)) continue;
    const { min: amountMin, max: amountMax } = parseAmountRange(amountRange);
    const footnotes = ptrFootnotesAfter(text, idx, endIdx);

    trades.push({
      chamber: "house",
      politicianName,
      state: header.state ?? state,
      district: header.district ?? district,
      owner: ownerBefore(text, idx) ?? footnotes.ownerDetail ?? undefined,
      ownerDetail: footnotes.ownerDetail,
      assetName,
      ticker: isTickerLike(rawTicker) ? rawTicker.toUpperCase() : null,
      assetType,
      transactionType,
      transactionCategory: mapTransactionCategory(transactionType),
      transactionDate,
      notificationDate,
      amountRange,
      amountMin,
      amountMax,
      capitalGainsOver200: footnotes.capitalGainsOver200,
      filingDate: filing.filingDate || null,
      filingId,
      sourceUrl,
      filingStatus: footnotes.filingStatus,
      comment: footnotes.description,
    });
  }

  return trades;
}

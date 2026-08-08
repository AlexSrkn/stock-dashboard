import { politicianFetchBuffer, politicianFetchText } from "../http.js";
import type { HouseFilingIndexEntry, PoliticianTrade } from "../types.js";
import {
  filterHousePtrFilings,
  housePoliticianName,
  parseHouseFinancialIndexXml,
} from "./parseIndex.js";
import { parseHousePtrPdfBuffer } from "./parsePtrPdf.js";
import { houseFinancialIndexXmlUrl, housePtrPdfUrl, parseHousePtrPdfUrl } from "./urls.js";

export async function fetchHouseFinancialIndex(year: number): Promise<HouseFilingIndexEntry[]> {
  const xml = await politicianFetchText(houseFinancialIndexXmlUrl(year));
  return parseHouseFinancialIndexXml(xml);
}

export async function fetchHousePtrTradesForFiling(
  filing: HouseFilingIndexEntry
): Promise<PoliticianTrade[]> {
  const pdf = await politicianFetchBuffer(housePtrPdfUrl(filing.year, filing.docId));
  return parseHousePtrPdfBuffer(pdf, filing);
}

/** Fetch and parse a direct House PTR PDF URL (e.g. .../ptr-pdfs/2024/20025819.pdf). */
export async function fetchHousePtrTradesFromPdfUrl(pdfUrl: string): Promise<PoliticianTrade[]> {
  const parsed = parseHousePtrPdfUrl(pdfUrl);
  if (!parsed) throw new Error(`Not a House PTR PDF URL: ${pdfUrl}`);
  const filing: HouseFilingIndexEntry = {
    prefix: "",
    lastName: "",
    firstName: "",
    suffix: "",
    filingType: "P",
    stateDst: "",
    year: parsed.year,
    filingDate: "",
    docId: parsed.docId,
  };
  const pdf = await politicianFetchBuffer(pdfUrl);
  return parseHousePtrPdfBuffer(pdf, filing);
}

export async function sampleHousePtrTrades({
  year,
  limit = 3,
}: {
  year: number;
  limit?: number;
}): Promise<{ filing: HouseFilingIndexEntry; trades: PoliticianTrade[] }[]> {
  const index = await fetchHouseFinancialIndex(year);
  const ptrFilings = filterHousePtrFilings(index, { year, limit });
  const out: { filing: HouseFilingIndexEntry; trades: PoliticianTrade[] }[] = [];

  for (const filing of ptrFilings) {
    const trades = await fetchHousePtrTradesForFiling(filing);
    out.push({ filing, trades });
  }

  return out;
}

export function summarizeHouseFiling(filing: HouseFilingIndexEntry) {
  return {
    name: housePoliticianName(filing),
    stateDst: filing.stateDst,
    filingDate: filing.filingDate,
    docId: filing.docId,
  };
}

import { XMLParser } from "fast-xml-parser";
import type { HouseFilingIndexEntry } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  isArray: (name) => name === "Member",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseHouseFinancialIndexXml(xml: string): HouseFilingIndexEntry[] {
  const root = parser.parse(xml) as { FinancialDisclosure?: { Member?: unknown } };
  const members = asArray(root.FinancialDisclosure?.Member);
  return members.map((m) => {
    const row = m as Record<string, string>;
    return {
      prefix: row.Prefix ?? "",
      lastName: row.Last ?? "",
      firstName: row.First ?? "",
      suffix: row.Suffix ?? "",
      filingType: row.FilingType ?? "",
      stateDst: row.StateDst ?? "",
      year: Number(row.Year) || 0,
      filingDate: row.FilingDate ?? "",
      docId: String(row.DocID ?? ""),
    };
  });
}

export function filterHousePtrFilings(
  entries: HouseFilingIndexEntry[],
  { year, limit }: { year?: number; limit?: number } = {}
): HouseFilingIndexEntry[] {
  let rows = entries.filter((e) => e.filingType === "P" && e.docId);
  if (year) rows = rows.filter((e) => e.year === year);
  rows = sortHousePtrFilingsNewest(rows);
  if (limit != null) rows = rows.slice(0, limit);
  return rows;
}

function parseHouseFilingDateMs(value: string): number {
  const m = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

export function sortHousePtrFilingsNewest(entries: HouseFilingIndexEntry[]): HouseFilingIndexEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = parseHouseFilingDateMs(b.filingDate) - parseHouseFilingDateMs(a.filingDate);
    if (byDate !== 0) return byDate;
    return Number(b.docId) - Number(a.docId);
  });
}

export function housePoliticianName(entry: HouseFilingIndexEntry): string {
  const parts = [entry.prefix, entry.firstName, entry.lastName, entry.suffix].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function parseHouseStateDistrict(stateDst: string): { state?: string; district?: string } {
  const m = String(stateDst || "").match(/^([A-Z]{2})(\d{2})?$/);
  if (!m) return {};
  return { state: m[1], district: m[2] ?? undefined };
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSecCik } from "../http.js";
import { isQuarterAtLeast, normalizeQuarterKey } from "../thirteenFInfo/quarter.js";
import { DEFAULT_MINIMUM_QUARTER } from "../thirteenFInfo/scrapeManagers.js";

export interface ImportManagerCandidate {
  id: string;
  cik: string;
  manager_name: string;
  location: string | null;
  latest_filing_quarter: string;
  source_url: string | null;
}

export function extractCikFromThirteenFInfoId(id: string): string | null {
  const m = String(id || "").trim().match(/^(\d{10})(?:-|$)/);
  if (m) return formatSecCik(m[1]);
  const digits = String(id || "").replace(/\D/g, "");
  if (digits.length >= 1 && digits.length <= 10) return formatSecCik(digits);
  return null;
}

function asManagerRows(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.managers)) return obj.managers as Array<Record<string, unknown>>;
  if (Array.isArray(obj.candidates)) return obj.candidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  return [];
}

/**
 * Load managers-all.json (or candidates JSON) and keep rows with
 * latest_filing_quarter >= minimumQuarter. Dedupes exact CIKs (first wins).
 */
export function loadThirteenFInfoImportUniverse(
  {
    path = join("data", "13f-info", "managers-all.json"),
    minimumQuarter = DEFAULT_MINIMUM_QUARTER,
  }: { path?: string; minimumQuarter?: string } = {}
): {
  minimumQuarter: string;
  sourcePath: string;
  managers: ImportManagerCandidate[];
  skippedMissingCik: number;
  skippedBelowQuarter: number;
  exactCikDuplicatesRemoved: number;
} {
  const minQ = normalizeQuarterKey(minimumQuarter) || DEFAULT_MINIMUM_QUARTER;
  if (!existsSync(path)) {
    throw new Error(`Missing source file: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const rows = asManagerRows(raw);

  const managers: ImportManagerCandidate[] = [];
  const seen = new Set<string>();
  let skippedMissingCik = 0;
  let skippedBelowQuarter = 0;
  let exactCikDuplicatesRemoved = 0;

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const name = String(row.manager_name ?? row.name ?? "").trim();
    const quarter = String(row.latest_filing_quarter ?? "").trim();
    if (!name) continue;
    if (!isQuarterAtLeast(quarter, minQ)) {
      skippedBelowQuarter += 1;
      continue;
    }
    const cik = extractCikFromThirteenFInfoId(id) || extractCikFromThirteenFInfoId(String(row.cik ?? ""));
    if (!cik) {
      skippedMissingCik += 1;
      continue;
    }
    if (seen.has(cik)) {
      exactCikDuplicatesRemoved += 1;
      continue;
    }
    seen.add(cik);
    managers.push({
      id: id || cik,
      cik,
      manager_name: name,
      location: row.location == null ? null : String(row.location),
      latest_filing_quarter: normalizeQuarterKey(quarter) || quarter,
      source_url: row.source_url == null ? null : String(row.source_url),
    });
  }

  managers.sort((a, b) => {
    const q = b.latest_filing_quarter.localeCompare(a.latest_filing_quarter);
    if (q !== 0) return q;
    return a.manager_name.localeCompare(b.manager_name);
  });

  return {
    minimumQuarter: minQ,
    sourcePath: path,
    managers,
    skippedMissingCik,
    skippedBelowQuarter,
    exactCikDuplicatesRemoved,
  };
}

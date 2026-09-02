import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { formatSecCik } from "../http.js";
import { normalizeQuarterKey } from "../thirteenFInfo/quarter.js";
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

/** CIKs that already have the target quarter in sec_filing (our scraped SEC data). */
export async function loadCiksWithQuarterInDb(
  pool: pg.Pool,
  quarter: string
): Promise<Set<string>> {
  const targetQ = normalizeQuarterKey(quarter) || quarter;
  const res = await pool.query<{ filer_cik: string }>(
    `SELECT DISTINCT filer_cik FROM sec_filing WHERE quarter = $1`,
    [targetQ]
  );
  return new Set(res.rows.map((row) => formatSecCik(row.filer_cik)));
}

/** Latest quarter per filer from our ingested SEC filings (not 13f.info labels). */
export async function loadLatestQuarterByCikFromDb(
  pool: pg.Pool
): Promise<Map<string, string>> {
  const latest = await pool.query<{ filer_cik: string; quarter: string }>(`
    SELECT DISTINCT ON (filer_cik) filer_cik, quarter
    FROM sec_filing
    WHERE quarter IS NOT NULL AND BTRIM(quarter) <> ''
    ORDER BY filer_cik, filing_date DESC, id DESC
  `);

  const byCik = new Map<string, string>();
  for (const row of latest.rows) {
    byCik.set(formatSecCik(row.filer_cik), normalizeQuarterKey(row.quarter) || row.quarter);
  }
  return byCik;
}

function managerNeedsTargetQuarter(cik: string, haveTargetQuarter: Set<string>): boolean {
  return !haveTargetQuarter.has(cik);
}

/**
 * Load managers-all.json (or candidates JSON). Dedupes exact CIKs (first wins).
 * When targetQuarter + pool are provided, queue only filers missing that quarter in sec_filing.
 * Never filters on 13f.info latest_filing_quarter (stale vs SEC).
 */
export function loadThirteenFInfoImportUniverse(
  {
    path = join("data", "13f-info", "managers-all.json"),
    minimumQuarter = DEFAULT_MINIMUM_QUARTER,
    latestQuarterByCik,
    haveTargetQuarter,
  }: {
    path?: string;
    minimumQuarter?: string;
    /** Latest ingested quarter per CIK (for display/sort only). */
    latestQuarterByCik?: Map<string, string>;
    /** When set, skip filers that already have minimumQuarter in sec_filing. */
    haveTargetQuarter?: Set<string>;
  } = {}
): {
  minimumQuarter: string;
  sourcePath: string;
  managers: ImportManagerCandidate[];
  skippedMissingCik: number;
  skippedAlreadyHaveQuarter: number;
  exactCikDuplicatesRemoved: number;
} {
  const targetQ = normalizeQuarterKey(minimumQuarter) || DEFAULT_MINIMUM_QUARTER;
  if (!existsSync(path)) {
    throw new Error(`Missing source file: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const rows = asManagerRows(raw);

  const managers: ImportManagerCandidate[] = [];
  const seen = new Set<string>();
  let skippedMissingCik = 0;
  let skippedAlreadyHaveQuarter = 0;
  let exactCikDuplicatesRemoved = 0;

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const name = String(row.manager_name ?? row.name ?? "").trim();
    if (!name) continue;
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

    const dbLatest = latestQuarterByCik?.get(cik) ?? null;
    if (haveTargetQuarter && !managerNeedsTargetQuarter(cik, haveTargetQuarter)) {
      skippedAlreadyHaveQuarter += 1;
      continue;
    }

    managers.push({
      id: id || cik,
      cik,
      manager_name: name,
      location: row.location == null ? null : String(row.location),
      latest_filing_quarter: dbLatest || normalizeQuarterKey(String(row.latest_filing_quarter ?? "")) || "",
      source_url: row.source_url == null ? null : String(row.source_url),
    });
  }

  managers.sort((a, b) => {
    const q = b.latest_filing_quarter.localeCompare(a.latest_filing_quarter);
    if (q !== 0) return q;
    return a.manager_name.localeCompare(b.manager_name);
  });

  return {
    minimumQuarter: targetQ,
    sourcePath: path,
    managers,
    skippedMissingCik,
    skippedAlreadyHaveQuarter,
    exactCikDuplicatesRemoved,
  };
}

export async function loadThirteenFInfoImportUniverseFromDb(
  pool: pg.Pool,
  options: { path?: string; minimumQuarter?: string } = {}
) {
  const targetQ = normalizeQuarterKey(options.minimumQuarter) || DEFAULT_MINIMUM_QUARTER;
  const [latestQuarterByCik, haveTargetQuarter] = await Promise.all([
    loadLatestQuarterByCikFromDb(pool),
    loadCiksWithQuarterInDb(pool, targetQ),
  ]);
  return loadThirteenFInfoImportUniverse({
    ...options,
    minimumQuarter: targetQ,
    latestQuarterByCik,
    haveTargetQuarter,
  });
}

/**
 * Institution directory: one canonical row per institution, with a normalized
 * name so different spellings ("BlackRock Inc.", "BlackRock Advisors") resolve to
 * the same entity ("blackrock"), and a classified institution type.
 *
 * Seeded from the curated 13F filer list (the institutions whose holdings we
 * ingest). Refresh is idempotent and runs as part of the ownership import.
 */
import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadOwnershipCacheSchemaSql } from "../../db/schema.js";
import { formatSecCik } from "../../sec/http.js";
import {
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "../../ownership/trackedInstitutions.js";
import type { InstitutionalManagerType } from "../../sec/seed/institutional-ciks.js";

export type InstitutionType =
  | "Asset Manager"
  | "Hedge Fund"
  | "Quant Fund"
  | "Pension Fund"
  | "Mutual Fund"
  | "ETF Provider"
  | "Sovereign Wealth Fund"
  | "Insurance Company"
  | "Family Office"
  | "Other";

export interface InstitutionRecord {
  cik: string;
  name: string;
  normalizedName: string;
  type: InstitutionType;
}

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "lp",
  "llp",
  "plc",
  "corp",
  "corporation",
  "co",
  "ltd",
  "sa",
  "ag",
  "nv",
  "se",
  "the",
  "group",
  "holdings",
  "holding",
  "management",
  "advisors",
  "advisers",
  "asset",
  "capital",
  "associates",
  "partners",
  "investments",
  "investment",
  "company",
  "trust",
  "global",
  "americas",
  "international",
]);

/** Normalize an institution name to a canonical search key (e.g. "BlackRock, Inc." -> "blackrock"). */
export function normalizeInstitutionName(name: string): string {
  const tokens = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Drop trailing legal/role words; keep at least the first token.
  const kept: string[] = [];
  for (const tok of tokens) {
    kept.push(tok);
  }
  while (kept.length > 1 && LEGAL_SUFFIXES.has(kept[kept.length - 1])) {
    kept.pop();
  }
  return kept.join(" ").trim();
}

const KEYWORD_TYPES: Array<{ re: RegExp; type: InstitutionType }> = [
  { re: /\b(pension|retirement|teachers?|calpers|calstrs|civil service)\b/i, type: "Pension Fund" },
  {
    re: /\b(sovereign|wealth fund|norges|temasek|gic|abu dhabi|qatar investment|kuwait investment)\b/i,
    type: "Sovereign Wealth Fund",
  },
  { re: /\b(insurance|assurance|life insurance|reinsurance)\b/i, type: "Insurance Company" },
  { re: /\b(ishares|spdr|etf)\b/i, type: "ETF Provider" },
  { re: /\b(family office)\b/i, type: "Family Office" },
  { re: /\b(mutual|funds trust|index funds)\b/i, type: "Mutual Fund" },
];

const SEED_TYPE_MAP: Record<InstitutionalManagerType, InstitutionType> = {
  asset_manager: "Asset Manager",
  hedge_fund: "Hedge Fund",
  quant: "Quant Fund",
  activist: "Hedge Fund",
};

/** Classify an institution into the public-facing type set. */
export function classifyInstitutionType(
  name: string,
  seedType?: InstitutionalManagerType
): InstitutionType {
  for (const { re, type } of KEYWORD_TYPES) {
    if (re.test(name)) return type;
  }
  if (seedType) return SEED_TYPE_MAP[seedType];
  return "Other";
}

/** Seed records derived from the curated 13F filer list. */
export function seedInstitutionRecords(): InstitutionRecord[] {
  return TRACKED_INSTITUTIONAL_MANAGERS.filter((m) => m.cik).map((m) => ({
    cik: formatSecCik(m.cik as string),
    name: m.name,
    normalizedName: normalizeInstitutionName(m.name),
    type: classifyInstitutionType(m.name, m.type),
  }));
}

export async function ensureOwnershipSchema(pool: pg.Pool = getPool()): Promise<void> {
  await pool.query(loadOwnershipCacheSchemaSql());
}

const UPSERT_SQL = `
INSERT INTO institution (cik, name, normalized_name, type, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (cik) DO UPDATE SET
  name = EXCLUDED.name,
  normalized_name = EXCLUDED.normalized_name,
  type = EXCLUDED.type,
  updated_at = NOW()
`.trim();

const UPSERT_KEEP_NAME_SQL = `
INSERT INTO institution (cik, name, normalized_name, type, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (cik) DO UPDATE SET
  type = EXCLUDED.type,
  updated_at = NOW()
`.trim();

/** Build a directory record using the same normalize/classify path as the seed. */
export function institutionRecordFromName(
  cik: string,
  name: string,
  seedType?: InstitutionalManagerType
): InstitutionRecord {
  return {
    cik: formatSecCik(cik),
    name: String(name || "").trim() || formatSecCik(cik),
    normalizedName: normalizeInstitutionName(name),
    type: classifyInstitutionType(name, seedType),
  };
}

/** Upsert one institution row (existing creation logic). */
export async function upsertInstitutionRecord(
  record: InstitutionRecord,
  pool: pg.Pool = getPool(),
  { keepExistingName = false }: { keepExistingName?: boolean } = {}
): Promise<void> {
  await ensureOwnershipSchema(pool);
  const sql = keepExistingName ? UPSERT_KEEP_NAME_SQL : UPSERT_SQL;
  await pool.query(sql, [record.cik, record.name, record.normalizedName, record.type]);
}

export async function upsertInstitutionRecords(
  records: InstitutionRecord[],
  pool: pg.Pool = getPool(),
  opts?: { keepExistingName?: boolean }
): Promise<number> {
  let n = 0;
  for (const rec of records) {
    await upsertInstitutionRecord(rec, pool, opts);
    n += 1;
  }
  return n;
}

/** Load existing institution directory keyed by padded CIK. */
export async function loadInstitutionDirectoryByCik(
  pool: pg.Pool = getPool()
): Promise<Map<string, { cik: string; name: string; type: string }>> {
  await ensureOwnershipSchema(pool);
  const res = await pool.query<{ cik: string; name: string; type: string }>(
    `SELECT cik, name, type FROM institution`
  );
  const map = new Map<string, { cik: string; name: string; type: string }>();
  for (const row of res.rows) {
    map.set(formatSecCik(row.cik), {
      cik: formatSecCik(row.cik),
      name: row.name,
      type: row.type,
    });
  }
  return map;
}

/** Idempotently (re)build the institution directory from the seed list. */
export async function refreshInstitutionDirectory(
  pool: pg.Pool = getPool()
): Promise<InstitutionRecord[]> {
  await ensureOwnershipSchema(pool);
  const records = seedInstitutionRecords();
  for (const rec of records) {
    await pool.query(UPSERT_SQL, [rec.cik, rec.name, rec.normalizedName, rec.type]);
  }
  return records;
}

/** In-memory directory (cik -> record) built from the seed; used by the cache builder. */
export function buildSeedDirectoryMap(): Map<string, InstitutionRecord> {
  const map = new Map<string, InstitutionRecord>();
  for (const rec of seedInstitutionRecords()) map.set(rec.cik, rec);
  return map;
}

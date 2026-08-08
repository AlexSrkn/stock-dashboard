/**
 * Fast institution lookup for the "Held by Institution" selector.
 * Prefix matches rank first ("Black" -> BlackRock, "Vang" -> Vanguard), with a
 * substring fallback. Backed by the indexed `institution` directory table.
 */
import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { normalizeInstitutionName } from "./InstitutionDirectory.js";

export interface InstitutionSearchResult {
  id: number;
  cik: string;
  name: string;
  type: string;
}

export async function searchInstitutions(
  query: string,
  pool: pg.Pool = getPool(),
  limit = 20
): Promise<InstitutionSearchResult[]> {
  const q = normalizeInstitutionName(query);
  const lim = Math.max(1, Math.min(100, limit));

  if (!q) {
    const res = await pool.query<InstitutionSearchResult>(
      `SELECT id, cik, name, type FROM institution ORDER BY name ASC LIMIT $1`,
      [lim]
    );
    return res.rows;
  }

  const prefix = `${q}%`;
  const substring = `%${q}%`;
  const res = await pool.query<InstitutionSearchResult>(
    `SELECT id, cik, name, type
     FROM institution
     WHERE normalized_name LIKE $1 OR LOWER(name) LIKE $1
     ORDER BY
       CASE WHEN normalized_name LIKE $2 OR LOWER(name) LIKE $2 THEN 0 ELSE 1 END,
       LENGTH(name) ASC,
       name ASC
     LIMIT $3`,
    [substring, prefix, lim]
  );
  return res.rows;
}

export async function listAllInstitutions(
  pool: pg.Pool = getPool()
): Promise<InstitutionSearchResult[]> {
  const res = await pool.query<InstitutionSearchResult>(
    `SELECT id, cik, name, type FROM institution ORDER BY name ASC`
  );
  return res.rows;
}

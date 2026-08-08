import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { compareInstitutions } from "./compute.js";
import type { InstitutionComparePayload } from "./types.js";

export type { InstitutionComparePayload } from "./types.js";

export async function getInstitutionComparison(
  pool: pg.Pool,
  cikA: string,
  cikB: string
): Promise<InstitutionComparePayload | null> {
  return compareInstitutions(pool, cikA, cikB);
}

export async function getInstitutionComparisonDefault(
  cikA: string,
  cikB: string
): Promise<InstitutionComparePayload | null> {
  return getInstitutionComparison(getPool(), cikA, cikB);
}

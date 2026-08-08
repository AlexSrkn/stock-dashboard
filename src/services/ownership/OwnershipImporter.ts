/**
 * Entry point for the ownership pipeline. Refreshes the institution directory and
 * rebuilds the ownership cache. Callable manually (npm run ownership:build-cache)
 * and automatically at the end of the 13F ownership import.
 */
import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { ensureOwnershipSchema, refreshInstitutionDirectory } from "./InstitutionDirectory.js";
import { buildOwnershipCache, type OwnershipBuildResult } from "./OwnershipCacheBuilder.js";

export interface OwnershipImportResult {
  institutions: number;
  build: OwnershipBuildResult;
}

export async function runOwnershipImport(pool: pg.Pool = getPool()): Promise<OwnershipImportResult> {
  await ensureOwnershipSchema(pool);
  const directory = await refreshInstitutionDirectory(pool);
  const build = await buildOwnershipCache(pool);
  return { institutions: directory.length, build };
}

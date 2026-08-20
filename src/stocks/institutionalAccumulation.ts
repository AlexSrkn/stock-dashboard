import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getCachedInstitutionalAccumulation } from "./institutionalAccumulationCache.js";
import type { InstitutionalAccumulationPayload } from "./institutionalAccumulationTypes.js";

export type {
  InstitutionalAccumulationPayload,
  InstitutionalAccumulationRow,
} from "./institutionalAccumulationTypes.js";

/**
 * Serve institutional accumulation from disk/memory cache only.
 * Live recompute can OOM the production Node process — warm offline instead:
 *   npm run stocks:warm-institutional-accumulation
 */
export async function loadInstitutionalShareAccumulation(
  _pool: pg.Pool = getPool(),
  limit = 100
): Promise<InstitutionalAccumulationPayload> {
  const cached = getCachedInstitutionalAccumulation(limit);
  if (cached) return cached;
  throw new Error(
    "Institutional accumulation cache not ready. Run: npm run stocks:warm-institutional-accumulation"
  );
}

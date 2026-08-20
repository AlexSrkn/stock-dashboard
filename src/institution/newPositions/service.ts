import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getCachedNewPositions } from "./cache.js";
import {
  queryNewInstitutionalPositions,
  type NewPositionsQuery,
  type NewPositionsQueryResult,
} from "./query.js";
import type { NewPositionsPayload } from "./types.js";

export type { NewPositionsPayload } from "./types.js";
export type { NewPositionsQuery, NewPositionsQueryResult } from "./query.js";
export {
  parseNewPositionsSortKey,
  parseNewPositionsSortDir,
  queryNewInstitutionalPositions,
} from "./query.js";

/**
 * Serve new positions from disk/memory cache only.
 * Live recompute over the full tracked universe OOMs the production Node process —
 * warm offline instead:
 *   npm run institutions:warm-new-positions
 */
export async function loadNewInstitutionalPositions(
  _pool: pg.Pool = getPool()
): Promise<NewPositionsPayload> {
  const cached = getCachedNewPositions();
  if (cached) return cached;
  throw new Error(
    "Institutional new positions cache not ready. Run: npm run institutions:warm-new-positions"
  );
}

export async function getNewInstitutionalPositions(pool: pg.Pool = getPool()) {
  return loadNewInstitutionalPositions(pool);
}

export async function getNewInstitutionalPositionsPage(
  query: NewPositionsQuery,
  pool: pg.Pool = getPool()
): Promise<NewPositionsQueryResult> {
  const payload = await loadNewInstitutionalPositions(pool);
  return queryNewInstitutionalPositions(payload, query);
}

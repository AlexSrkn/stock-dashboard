import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getCachedNewPositions,
  setNewPositionsMemoryCache,
} from "./cache.js";
import { computeNewInstitutionalPositions } from "./compute.js";
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

let inflight: Promise<NewPositionsPayload> | null = null;

export async function loadNewInstitutionalPositions(
  pool: pg.Pool = getPool()
): Promise<NewPositionsPayload> {
  const cached = getCachedNewPositions();
  if (cached) return cached;

  if (!inflight) {
    inflight = computeNewInstitutionalPositions(pool)
      .then((payload) => {
        setNewPositionsMemoryCache(payload);
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
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

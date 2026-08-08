import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getCachedNewPositions,
  setNewPositionsMemoryCache,
} from "./cache.js";
import { computeNewInstitutionalPositions } from "./compute.js";
import type { NewPositionsPayload } from "./types.js";

export type { NewPositionsPayload } from "./types.js";

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

import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getCachedCompletelySold,
  saveCompletelySoldToDisk,
  setCompletelySoldMemoryCache,
} from "./cache.js";
import { computeCompletelySoldPositions } from "./compute.js";
import type { CompletelySoldPayload } from "./types.js";

export type { CompletelySoldPayload } from "./types.js";

let inflight: Promise<CompletelySoldPayload> | null = null;

export async function loadCompletelySoldPositions(
  pool: pg.Pool = getPool()
): Promise<CompletelySoldPayload> {
  const cached = getCachedCompletelySold();
  if (cached) return cached;

  if (!inflight) {
    inflight = computeCompletelySoldPositions(pool)
      .then((payload) => {
        setCompletelySoldMemoryCache(payload);
        if (payload.positions.length) saveCompletelySoldToDisk(payload);
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

export async function getCompletelySoldPositions(pool: pg.Pool = getPool()) {
  return loadCompletelySoldPositions(pool);
}

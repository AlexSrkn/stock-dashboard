import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getCachedMostAccumulated,
  parseMostAccumulatedPeriod,
  setMostAccumulatedMemoryCache,
} from "./cache.js";
import { computeMostAccumulated } from "./compute.js";
import type { MostAccumulatedPeriod, MostAccumulatedPayload } from "./types.js";

export type { MostAccumulatedPayload, MostAccumulatedPeriod } from "./types.js";
export { parseMostAccumulatedPeriod } from "./cache.js";

let inflight: Promise<MostAccumulatedPayload> | null = null;

export async function loadMostAccumulated(
  _pool: pg.Pool = getPool()
): Promise<MostAccumulatedPayload> {
  const cached = getCachedMostAccumulated();
  if (cached) return cached;

  if (!inflight) {
    inflight = computeMostAccumulated(_pool)
      .then((payload) => {
        setMostAccumulatedMemoryCache(payload);
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

export async function getMostAccumulatedPeriod(
  period: MostAccumulatedPeriod,
  pool: pg.Pool = getPool()
) {
  const payload = await loadMostAccumulated(pool);
  return {
    computedAt: payload.computedAt,
    sectors: payload.sectors,
    ...payload.periods[period],
  };
}

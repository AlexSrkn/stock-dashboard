import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getCachedMostAccumulated,
  parseMostAccumulatedPeriod,
} from "./cache.js";
import type { MostAccumulatedPeriod, MostAccumulatedPayload } from "./types.js";

export type { MostAccumulatedPayload, MostAccumulatedPeriod } from "./types.js";
export { parseMostAccumulatedPeriod } from "./cache.js";

/**
 * Serve most-accumulated from disk/memory cache only.
 * Live recompute loads multi-quarter holdings for the tracked universe and can OOM
 * the production Node process (nginx 502) — warm offline instead:
 *   npm run institutions:warm-most-accumulated
 */
export async function loadMostAccumulated(
  _pool: pg.Pool = getPool()
): Promise<MostAccumulatedPayload> {
  const cached = getCachedMostAccumulated();
  if (cached) return cached;
  throw new Error(
    "Most accumulated cache not ready. Run: npm run institutions:warm-most-accumulated"
  );
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

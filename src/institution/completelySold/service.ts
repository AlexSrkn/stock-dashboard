import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getCachedCompletelySold } from "./cache.js";
import type { CompletelySoldPayload } from "./types.js";

export type { CompletelySoldPayload } from "./types.js";

/**
 * Serve completely-sold from disk/memory cache only.
 * Live recompute over the full tracked universe OOMs the production Node process —
 * warm offline instead:
 *   npm run institutions:warm-completely-sold
 */
export async function loadCompletelySoldPositions(
  _pool: pg.Pool = getPool()
): Promise<CompletelySoldPayload> {
  const cached = getCachedCompletelySold();
  if (cached) return cached;
  throw new Error(
    "Institutional completely-sold cache not ready. Run: npm run institutions:warm-completely-sold"
  );
}

export async function getCompletelySoldPositions(pool: pg.Pool = getPool()) {
  return loadCompletelySoldPositions(pool);
}

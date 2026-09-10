import type pg from "pg";

const CACHE_TTL_MS = 30 * 60 * 1000;

let cache: { at: number; current: string; previous: string | null } | null = null;
let inflight: Promise<{ current: string; previous: string | null }> | null = null;

/**
 * Latest two 13F quarters. Uses MAX(quarter) (index-friendly) instead of
 * DISTINCT/GROUP BY over the full holdings table (~seconds → milliseconds).
 */
export async function latestHoldingQuarters(
  pool: pg.Pool
): Promise<{ current: string; previous: string | null }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { current: cache.current, previous: cache.previous };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await pool.query<{ current: string | null; previous: string | null }>(
      `
      WITH cur AS (
        SELECT MAX(quarter) AS quarter
        FROM sec_holding
        WHERE quarter IS NOT NULL AND BTRIM(quarter) <> ''
      ),
      prev AS (
        SELECT MAX(quarter) AS quarter
        FROM sec_holding
        WHERE quarter IS NOT NULL
          AND BTRIM(quarter) <> ''
          AND quarter < (SELECT quarter FROM cur)
      )
      SELECT cur.quarter AS current, prev.quarter AS previous
      FROM cur
      LEFT JOIN prev ON TRUE
      `
    );
    const current = String(res.rows[0]?.current || "");
    const previous = res.rows[0]?.previous ? String(res.rows[0].previous) : null;
    cache = { at: Date.now(), current, previous };
    return { current, previous };
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function clearLatestHoldingQuartersCache(): void {
  cache = null;
  inflight = null;
}

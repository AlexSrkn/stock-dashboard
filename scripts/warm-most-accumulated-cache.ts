/**
 * Precompute most-accumulated institutional rankings for all periods.
 * Usage: npm run institutions:warm-most-accumulated
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { listTrackedInstitutions } from "../src/institution/institutionAnalytics.js";
import { saveMostAccumulatedToDisk } from "../src/institution/mostAccumulated/cache.js";
import { computeMostAccumulated } from "../src/institution/mostAccumulated/compute.js";

loadEnvFile();
// Full-universe holdings load can exceed the default pool statement_timeout.
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

const pool = getPool();
console.log(
  `Warming most-accumulated for ${listTrackedInstitutions().length} tracked institutions…`
);

const payload = await computeMostAccumulated(pool);
const quarterCount = payload.periods.quarter.stocks.length;
if (!quarterCount) {
  console.error("No most-accumulated rows computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveMostAccumulatedToDisk(payload);
console.log(
  `Most accumulated cache saved: quarter=${quarterCount}, 30d=${payload.periods["30d"].stocks.length}, year=${payload.periods.year.stocks.length} → data/cache/most-accumulated.json`
);
await closePool();

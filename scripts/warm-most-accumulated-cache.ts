/**
 * Precompute most-accumulated institutional rankings for all periods.
 * Usage: npm run institutions:warm-most-accumulated
 *
 * Uses the full curated + imported tracked universe, loading holdings in CIK
 * batches so the job fits on a 4GB VPS.
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { listTrackedInstitutions } from "../src/institution/institutionAnalytics.js";
import { saveMostAccumulatedToDisk } from "../src/institution/mostAccumulated/cache.js";
import { computeMostAccumulated } from "../src/institution/mostAccumulated/compute.js";
import { trackedInstitutionCiks } from "../src/institution/mostAccumulated/queries.js";
import { reloadTrackedInstitutions } from "../src/ownership/trackedInstitutions.js";

loadEnvFile();
// Full-universe holdings load can exceed the default pool statement_timeout.
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

reloadTrackedInstitutions(true);
const pool = getPool();
const cikCount = trackedInstitutionCiks().length;
console.log(
  `Warming most-accumulated for ${cikCount} tracked institutions (${listTrackedInstitutions().length} directory rows)…`
);

const payload = await computeMostAccumulated(pool);
const quarterCount = payload.periods.quarter.stocks.length;
const topBuyers = payload.periods.quarter.stocks[0]?.institutionsBuying ?? 0;
if (!quarterCount) {
  console.error("No most-accumulated rows computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveMostAccumulatedToDisk(payload);
console.log(
  `Most accumulated cache saved: quarter=${quarterCount} (top Institutions Buying=${topBuyers}), 30d=${payload.periods["30d"].stocks.length}, year=${payload.periods.year.stocks.length} → data/cache/most-accumulated.json`
);
await closePool();

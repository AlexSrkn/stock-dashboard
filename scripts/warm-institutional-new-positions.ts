/**
 * Precompute institutional new positions across all tracked filers.
 * Usage: npm run institutions:warm-new-positions
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { saveNewPositionsToDisk } from "../src/institution/newPositions/cache.js";
import { computeNewInstitutionalPositions } from "../src/institution/newPositions/compute.js";
import { listTrackedInstitutions } from "../src/institution/institutionAnalytics.js";
import { reloadTrackedInstitutions } from "../src/ownership/trackedInstitutions.js";

loadEnvFile();
// Full-universe activity load can exceed the default pool statement_timeout.
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

reloadTrackedInstitutions(true);
const pool = getPool();
console.log(`Warming new positions for ${listTrackedInstitutions().length} tracked institutions…`);

const payload = await computeNewInstitutionalPositions(pool);
if (!payload.positions.length) {
  console.error("No new positions computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveNewPositionsToDisk(payload);
console.log(
  `Institutional new positions cache saved: ${payload.positions.length} positions, ${payload.summary.institutionsReporting} institutions → data/cache/institutional-new-positions.json`
);
await closePool();

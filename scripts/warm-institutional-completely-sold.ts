/**
 * Precompute institutional completely sold positions across all tracked filers.
 * Usage: npm run institutions:warm-completely-sold
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { saveCompletelySoldToDisk } from "../src/institution/completelySold/cache.js";
import { computeCompletelySoldPositions } from "../src/institution/completelySold/compute.js";
import { listTrackedInstitutions } from "../src/institution/institutionAnalytics.js";

loadEnvFile();
// Full-universe activity load can exceed the default pool statement_timeout.
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

const pool = getPool();
console.log(`Warming completely sold for ${listTrackedInstitutions().length} tracked institutions…`);

const payload = await computeCompletelySoldPositions(pool);
if (!payload.positions.length) {
  console.error("No completely sold positions computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveCompletelySoldToDisk(payload);
console.log(
  `Institutional completely sold cache saved: ${payload.positions.length} stocks, ${payload.summary.institutionsReporting} institutions → data/cache/institutional-completely-sold.json`
);
await closePool();

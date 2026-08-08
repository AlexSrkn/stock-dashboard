/**
 * Precompute institutional new positions across all tracked filers.
 * Usage: npm run institutions:warm-new-positions
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { saveNewPositionsToDisk } from "../src/institution/newPositions/cache.js";
import { computeNewInstitutionalPositions } from "../src/institution/newPositions/compute.js";

loadEnvFile();

const payload = await computeNewInstitutionalPositions();
if (!payload.positions.length) {
  console.error("No new positions computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveNewPositionsToDisk(payload);
console.log(
  `Institutional new positions cache saved: ${payload.positions.length} positions, ${payload.summary.institutionsReporting} institutions → data/cache/institutional-new-positions.json`
);
await closePool();

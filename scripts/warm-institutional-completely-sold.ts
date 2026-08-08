/**
 * Precompute institutional completely sold positions across all tracked filers.
 * Usage: npm run institutions:warm-completely-sold
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { saveCompletelySoldToDisk } from "../src/institution/completelySold/cache.js";
import { computeCompletelySoldPositions } from "../src/institution/completelySold/compute.js";

loadEnvFile();

const payload = await computeCompletelySoldPositions();
if (!payload.positions.length) {
  console.error("No completely sold positions computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveCompletelySoldToDisk(payload);
console.log(
  `Institutional completely sold cache saved: ${payload.positions.length} positions, ${payload.summary.institutionsReporting} institutions → data/cache/institutional-completely-sold.json`
);
await closePool();

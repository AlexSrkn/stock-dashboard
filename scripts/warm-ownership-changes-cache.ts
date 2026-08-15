/**
 * Precompute quarter-over-quarter institutional ownership changes.
 * Usage: npm run stocks:warm-ownership-changes
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import {
  computeOwnershipChangesCache,
} from "../src/stocks/ownershipChanges/compute.js";
import { saveOwnershipChangesToDisk } from "../src/stocks/ownershipChanges/cache.js";

loadEnvFile();

const payload = await computeOwnershipChangesCache();
const latest = payload.quarters[0];
const def = payload.defaultQuarter ?? latest;
const count = def ? (payload.byQuarter[def]?.length ?? 0) : 0;
if (!count) {
  console.error("No ownership change rows computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveOwnershipChangesToDisk(payload);
console.log(
  `Ownership movers cache saved: ${payload.quarters.length} quarters, default=${def} (newest=${latest}, ${count} tickers) → data/cache/ownership-changes.json`
);
await closePool();

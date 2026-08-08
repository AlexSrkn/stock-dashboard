/**
 * Precompute most-accumulated institutional rankings for all periods.
 * Usage: npm run institutions:warm-most-accumulated
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { saveMostAccumulatedToDisk } from "../src/institution/mostAccumulated/cache.js";
import { computeMostAccumulated } from "../src/institution/mostAccumulated/compute.js";

loadEnvFile();

const payload = await computeMostAccumulated();
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

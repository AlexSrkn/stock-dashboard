/**
 * Precompute stocks most-accumulated rankings for 30d / 90d / 1y.
 * Usage: npm run stocks:warm-most-accumulated
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { saveStocksMostAccumulatedToDisk } from "../src/stocks/mostAccumulated/cache.js";
import { computeStocksMostAccumulatedCache } from "../src/stocks/mostAccumulated/compute.js";

loadEnvFile();
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

const pool = getPool();
console.log("Warming stocks most-accumulated rankings…");

const payload = await computeStocksMostAccumulatedCache(pool);
const count90 = payload.periods["90d"]?.stocks.length ?? 0;
if (!count90) {
  console.error("No stocks most-accumulated rows computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveStocksMostAccumulatedToDisk(payload);
console.log(
  `Stocks most-accumulated cache saved: 30d=${payload.periods["30d"].stocks.length}, 90d=${count90}, year=${payload.periods.year.stocks.length} → data/cache/stocks-most-accumulated.json`
);
await closePool();

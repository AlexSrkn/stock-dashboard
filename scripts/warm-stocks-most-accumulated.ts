/**
 * Precompute stocks most-accumulated rankings for 30d / 90d / 1y.
 * Usage: npm run stocks:warm-most-accumulated
 *
 * Depends on a fresh institutions most-accumulated cache — run that first:
 *   npm run institutions:warm-most-accumulated
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { loadMostAccumulatedFromDisk } from "../src/institution/mostAccumulated/cache.js";
import { saveStocksMostAccumulatedToDisk } from "../src/stocks/mostAccumulated/cache.js";
import { computeStocksMostAccumulatedCache } from "../src/stocks/mostAccumulated/compute.js";

loadEnvFile();
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

const inst = loadMostAccumulatedFromDisk();
if (!inst) {
  console.error(
    "Institutions most-accumulated cache missing. Run first:\n  npm run institutions:warm-most-accumulated"
  );
  process.exit(1);
}
const instQuarter = inst.periods.quarter?.stocks ?? [];
const instAvgBuyers =
  instQuarter.length > 0
    ? instQuarter.reduce((s, r) => s + (r.institutionsBuying ?? 0), 0) / instQuarter.length
    : 0;
console.log(
  `Using institutions cache computedAt=${inst.computedAt} quarter=${instQuarter.length} avg Institutions Buying=${instAvgBuyers.toFixed(1)}`
);

const pool = getPool();
console.log("Warming stocks most-accumulated rankings…");

const payload = await computeStocksMostAccumulatedCache(pool);
const count90 = payload.periods["90d"]?.stocks.length ?? 0;
if (!count90) {
  console.error("No stocks most-accumulated rows computed. Existing cache was not overwritten.");
  process.exit(1);
}
const stocks90 = payload.periods["90d"].stocks;
const stocksAvgBuyers =
  stocks90.reduce((s, r) => s + (r.buyerCount ?? 0), 0) / stocks90.length;
if (instAvgBuyers >= 10 && stocksAvgBuyers < 5) {
  console.warn(
    `Warning: stocks 90d avg buyers=${stocksAvgBuyers.toFixed(1)} looks thin vs institutions avg ${instAvgBuyers.toFixed(1)}. Re-run after a successful institutions:warm-most-accumulated.`
  );
}
saveStocksMostAccumulatedToDisk(payload);
console.log(
  `Stocks most-accumulated cache saved: 30d=${payload.periods["30d"].stocks.length}, 90d=${count90} (avg buyers=${stocksAvgBuyers.toFixed(1)}), year=${payload.periods.year.stocks.length} → data/cache/stocks-most-accumulated.json`
);
await closePool();

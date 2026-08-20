/**
 * Precompute institutional share accumulation rankings.
 * Usage: npm run stocks:warm-institutional-accumulation
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { computeInstitutionalShareAccumulation } from "../src/stocks/institutionalAccumulationCompute.js";
import { saveInstitutionalAccumulationToDisk } from "../src/stocks/institutionalAccumulationCache.js";

loadEnvFile();
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

const payload = await computeInstitutionalShareAccumulation();
if (!payload.stocks.length) {
  console.error("No institutional accumulation rows computed. Existing cache was not overwritten.");
  process.exit(1);
}
saveInstitutionalAccumulationToDisk(payload);
console.log(
  `Institutional accumulation cache saved: ${payload.stocks.length} tickers (${payload.currentQuarter}) → data/cache/institutional-accumulation.json`
);
await closePool();

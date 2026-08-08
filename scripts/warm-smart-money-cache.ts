/**
 * Precompute smart money conviction scores and save to disk.
 * Run after data ingest, or on a schedule — not on every npm start.
 *
 * Usage: npm run smart-money:warm-cache
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { saveSmartMoneyScoresToDisk } from "../src/smartMoney/cache.js";
import { getSmartMoneyService } from "../src/smartMoney/smartMoneyService.js";

loadEnvFile();

const service = getSmartMoneyService();
const scores = await service.computeAllScores();
if (!scores.length) {
  console.error(
    "No smart money scores matched (need institutional + insider + Congress on the same ticker). Existing cache was not overwritten."
  );
  process.exit(1);
}
saveSmartMoneyScoresToDisk(scores);
console.log(`Smart money cache saved: ${scores.length} tickers → data/cache/smart-money-scores.json`);
await closePool();

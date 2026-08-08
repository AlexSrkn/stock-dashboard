/**
 * Precompute ownership history rankings.
 * Usage: npm run stocks:warm-ownership-history
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { computeOwnershipHistoryCache } from "../src/stocks/ownershipHistory/compute.js";
import { saveOwnershipHistoryToDisk } from "../src/stocks/ownershipHistory/cache.js";

loadEnvFile();

const pool = getPool();
console.log("Computing ownership history…");
const t0 = Date.now();
try {
  const payload = await computeOwnershipHistoryCache(pool);
  saveOwnershipHistoryToDisk(payload);
  const latest = payload.currentQuarter;
  const count = latest ? (payload.byQuarter[latest]?.length ?? 0) : 0;
  console.log(
    `Saved ${count} tickers for ${latest || "—"}` +
      (payload.previousQuarter ? ` vs ${payload.previousQuarter}` : "") +
      ` · ${payload.quarters.length} quarter pairs · ${Date.now() - t0}ms`
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}

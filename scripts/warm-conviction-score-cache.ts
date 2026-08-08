/**
 * Precompute institutional conviction score cache.
 * Usage: npm run signals:warm-conviction-score
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { computeConvictionScores } from "../src/signals/convictionScore/compute.js";
import { saveConvictionScoreToDisk } from "../src/signals/convictionScore/cache.js";

loadEnvFile();

const pool = getPool();
console.log("Computing conviction scores…");
const t0 = Date.now();
try {
  const payload = await computeConvictionScores(pool);
  saveConvictionScoreToDisk(payload);
  const scored = payload.signals.filter((s) => !s.insufficientData && s.convictionScore != null);
  const latest = scored.filter((s) => s.quarter === payload.currentQuarter);
  console.log(
    `Saved ${scored.length} scored rows (${latest.length} in ${payload.currentQuarter}) · ${Date.now() - t0}ms`
  );
  if (payload.summary.highestConviction) {
    console.log(
      `  highest=${payload.summary.highestConviction.ticker} ${payload.summary.highestConviction.score}` +
        ` · avg=${payload.summary.averageConviction}` +
        ` · high=${payload.summary.highConvictionStocks}` +
        ` · exceptional=${payload.summary.exceptionalConvictionStocks}`
    );
  }
} finally {
  await closePool();
}

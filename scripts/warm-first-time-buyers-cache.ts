/**
 * Precompute First-Time Buyers from Form 4 open-market purchases.
 * Usage: npm run insiders:warm-first-time-buyers
 */
import { computeFirstTimeBuyers } from "../src/insider/firstTimeBuyers/compute.js";
import { saveFirstTimeBuyersToDisk } from "../src/insider/firstTimeBuyers/cache.js";
import { getPool } from "../src/db/pool.js";

async function main() {
  const pool = getPool();
  try {
    console.log("Computing first-time buyers…");
    const payload = await computeFirstTimeBuyers(pool);
    if (!payload.rows.length) {
      console.warn("No first-time / long-gap open-market buys found.");
      return;
    }
    saveFirstTimeBuyersToDisk(payload);
    const firstEver = payload.rows.filter((r) => r.firstEverPurchase).length;
    const high = payload.rows.filter((r) => r.firstTimeBuyerScore >= 85).length;
    console.log(
      `First-time buyers cache saved: ${payload.rows.length} trades (≥${payload.minYearsThreshold}y gap), ${firstEver} first-ever, ${high} high conviction → data/cache/first-time-buyers.json`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Precompute Conviction Buys rankings from Form 4 open-market purchases.
 * Usage: npm run insiders:warm-conviction-buys
 */
import { computeConvictionBuys } from "../src/insider/convictionBuys/compute.js";
import { saveConvictionBuysToDisk } from "../src/insider/convictionBuys/cache.js";
import { getPool } from "../src/db/pool.js";

async function main() {
  const pool = getPool();
  try {
    console.log("Computing conviction buys…");
    const payload = await computeConvictionBuys(pool);
    if (!payload.rows.length) {
      console.warn("No open-market Form 4 purchases found.");
      return;
    }
    saveConvictionBuysToDisk(payload);
    const high = payload.rows.filter((r) => r.convictionScore >= 70).length;
    const exceptional = payload.rows.filter((r) => r.convictionScore >= 85).length;
    console.log(
      `Conviction buys cache saved: ${payload.rows.length} trades, ${high} high+, ${exceptional} exceptional → data/cache/conviction-buys.json`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

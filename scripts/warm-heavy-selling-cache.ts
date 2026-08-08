/**
 * Precompute Heavy Selling rankings from Form 4 open-market sells.
 * Usage: npm run insiders:warm-heavy-selling
 */
import { computeHeavySelling } from "../src/insider/heavySelling/compute.js";
import { saveHeavySellingToDisk } from "../src/insider/heavySelling/cache.js";
import { getPool } from "../src/db/pool.js";

async function main() {
  const pool = getPool();
  try {
    console.log("Computing heavy selling…");
    const payload = await computeHeavySelling(pool);
    if (!payload.rows.length) {
      console.warn("No open-market Form 4 sells found.");
      return;
    }
    saveHeavySellingToDisk(payload);
    const clusters = payload.rows.filter((r) => r.clusterSelling).length;
    const extreme = payload.rows.filter((r) => r.heavySellingScore >= 85).length;
    console.log(
      `Heavy selling cache saved: ${payload.rows.length} tickers, ${clusters} clusters (${payload.clusterWindowDays}d), ${extreme} extreme → data/cache/heavy-selling.json`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

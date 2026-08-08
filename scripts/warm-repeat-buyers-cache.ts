/**
 * Precompute Repeat Buyers rankings from Form 4 open-market purchases.
 * Usage: npm run insiders:warm-repeat-buyers
 */
import { computeRepeatBuyers } from "../src/insider/repeatBuyers/compute.js";
import { saveRepeatBuyersToDisk } from "../src/insider/repeatBuyers/cache.js";
import { getPool } from "../src/db/pool.js";

async function main() {
  const pool = getPool();
  try {
    console.log("Computing repeat buyers…");
    const payload = await computeRepeatBuyers(pool);
    if (!payload.rows.length) {
      console.warn("No repeat buyer pairs found (need ≥2 open-market buys per insider/ticker).");
      return;
    }
    saveRepeatBuyersToDisk(payload);
    const active = payload.rows.filter((r) => r.repeatBuyerScore >= 40).length;
    const serial = payload.rows.filter((r) => r.repeatBuyerScore >= 85).length;
    console.log(
      `Repeat buyers cache saved: ${payload.rows.length} pairs, ${active} active (≥40), ${serial} serial → data/cache/repeat-buyers.json`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

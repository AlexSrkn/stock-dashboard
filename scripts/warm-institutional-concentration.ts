/**
 * Precompute institutional concentration (institution × industry QoQ bets).
 * Usage: npm run sector:warm-institutional-concentration
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { recomputeInstitutionalConcentration } from "../src/stocks/institutionalConcentration.js";

loadEnvFile();

const t0 = Date.now();
const payload = await recomputeInstitutionalConcentration();
console.log(
  `Institutional concentration saved: ${payload.institutions.length} rows, ${payload.previousQuarter} → ${payload.currentQuarter} (${Date.now() - t0}ms) → data/cache/sectors/institutional-concentration.json`
);
await closePool();

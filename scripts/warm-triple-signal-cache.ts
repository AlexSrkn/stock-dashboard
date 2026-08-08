/**
 * Precompute triple signal caches for all window sizes.
 * Usage: npm run signals:warm-triple-signal
 */
import { getPool, loadEnvFile } from "../src/db/pool.js";
import { computeTripleSignals } from "../src/signals/tripleSignal/compute.js";
import { saveTripleSignalToDisk } from "../src/signals/tripleSignal/cache.js";
import { TRIPLE_SIGNAL_WINDOW_OPTIONS } from "../src/signals/tripleSignal/types.js";

loadEnvFile();

const pool = getPool();

for (const windowDays of TRIPLE_SIGNAL_WINDOW_OPTIONS) {
  console.log(`Computing triple signals (${windowDays}d)…`);
  const payload = await computeTripleSignals(windowDays, pool);
  saveTripleSignalToDisk(payload);
  console.log(
    `  ${payload.signals.length} signals · ${payload.summary.institutionsInvolved} institutions · ${payload.summary.insiderPurchases} insider purchases · ${payload.summary.politicianPurchases} politician purchases`
  );
}

console.log("Triple signal caches saved to data/cache/triple-signal-*.json");

/**
 * Precompute double signal caches for all window sizes.
 * Usage: npm run signals:warm-double-signal
 */
import { getPool, loadEnvFile } from "../src/db/pool.js";
import { computeDoubleSignals } from "../src/signals/doubleSignal/compute.js";
import { saveDoubleSignalToDisk } from "../src/signals/doubleSignal/cache.js";
import { DOUBLE_SIGNAL_WINDOW_OPTIONS } from "../src/signals/doubleSignal/types.js";

loadEnvFile();

const pool = getPool();

for (const windowDays of DOUBLE_SIGNAL_WINDOW_OPTIONS) {
  console.log(`Computing double signals (${windowDays}d)…`);
  const payload = await computeDoubleSignals(windowDays, pool);
  saveDoubleSignalToDisk(payload);
  console.log(
    `  ${payload.signals.length} signals · ${payload.summary.institutionsInvolved} institutions · ${payload.summary.insiderPurchases} insider purchases`
  );
}

console.log("Double signal caches saved to data/cache/double-signal-*.json");

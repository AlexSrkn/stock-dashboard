/**
 * Precompute institutional discovery cache.
 * Usage: npm run signals:warm-institutional-discovery
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { computeInstitutionalDiscovery } from "../src/signals/institutionalDiscovery/compute.js";
import { saveInstitutionalDiscoveryToDisk } from "../src/signals/institutionalDiscovery/cache.js";

loadEnvFile();

const pool = getPool();
console.log("Computing institutional discovery…");
const t0 = Date.now();
try {
  const payload = await computeInstitutionalDiscovery(pool);
  saveInstitutionalDiscoveryToDisk(payload);
  const scored = payload.signals.filter((s) => !s.insufficientData && s.discoveryScore != null);
  const latest = scored.filter((s) => s.quarter === payload.currentQuarter);
  console.log(
    `Saved ${scored.length} scored rows (${latest.length} in ${payload.currentQuarter}) · ${Date.now() - t0}ms`
  );
  console.log(
    `  discoveries=${payload.summary.newDiscoveries}` +
      ` · newPositions=${payload.summary.newInstitutionalPositions}` +
      (payload.summary.fastestHolderGrowth
        ? ` · fastest=${payload.summary.fastestHolderGrowth.ticker} ${payload.summary.fastestHolderGrowth.holderGrowthPercent}%`
        : "") +
      (payload.summary.longestAdoptionStreak
        ? ` · streak=${payload.summary.longestAdoptionStreak.ticker} ${payload.summary.longestAdoptionStreak.streak}`
        : "")
  );
} finally {
  await closePool();
}

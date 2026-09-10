/**
 * Precompute institutional discovery cache (full tracked institution universe).
 * Usage: npm run signals:warm-institutional-discovery
 *
 * Requires data/13f-info/imported-tracked-managers.json on the server and
 * 13F holdings in the DB for those CIKs.
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { trackedInstitutionCiks } from "../src/institution/mostAccumulated/queries.js";
import { reloadTrackedInstitutions } from "../src/ownership/trackedInstitutions.js";
import { computeInstitutionalDiscovery } from "../src/signals/institutionalDiscovery/compute.js";
import { saveInstitutionalDiscoveryToDisk } from "../src/signals/institutionalDiscovery/cache.js";

loadEnvFile();
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

reloadTrackedInstitutions(true);
const cikCount = trackedInstitutionCiks().length;
console.log(`Warming institutional discovery for ${cikCount} tracked institutions…`);
if (cikCount < 100) {
  console.error(
    "Tracked universe looks curated-only. Copy/import data/13f-info/imported-tracked-managers.json first."
  );
  process.exit(1);
}

const pool = getPool();
const t0 = Date.now();
try {
  const payload = await computeInstitutionalDiscovery(pool);
  const scored = payload.signals.filter((s) => !s.insufficientData && s.discoveryScore != null);
  const latest = scored.filter((s) => s.quarter === payload.currentQuarter);
  const maxHolders = latest.reduce((m, r) => Math.max(m, r.currentHolderCount ?? 0), 0);

  if (!scored.length) {
    console.error("No institutional discovery rows computed. Existing cache was not overwritten.");
    process.exitCode = 1;
  } else if (maxHolders < 100) {
    console.error(
      `Refusing to save: max currentHolderCount in ${payload.currentQuarter} is only ${maxHolders} (expected hundreds+). Check imported-tracked-managers.json and that 13F holdings exist for the tracked CIKs.`
    );
    process.exitCode = 1;
  } else {
    saveInstitutionalDiscoveryToDisk(payload);
    console.log(
      `Saved ${scored.length} scored rows (${latest.length} in ${payload.currentQuarter}) · max holders=${maxHolders} · ${Date.now() - t0}ms`
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
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}

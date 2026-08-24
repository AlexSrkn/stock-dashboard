/**
 * Precompute ownership history rankings (full tracked institution universe).
 * Usage: npm run stocks:warm-ownership-history
 *
 * Requires data/13f-info/imported-tracked-managers.json on the server.
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { trackedInstitutionCiks } from "../src/institution/mostAccumulated/queries.js";
import { reloadTrackedInstitutions } from "../src/ownership/trackedInstitutions.js";
import { computeOwnershipHistoryCache } from "../src/stocks/ownershipHistory/compute.js";
import { saveOwnershipHistoryToDisk } from "../src/stocks/ownershipHistory/cache.js";

loadEnvFile();
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

reloadTrackedInstitutions(true);
const cikCount = trackedInstitutionCiks().length;
console.log("Warming ownership history for " + cikCount + " tracked institutions...");
if (cikCount < 100) {
  console.error(
    "Tracked universe looks curated-only. Copy/import data/13f-info/imported-tracked-managers.json first."
  );
  process.exit(1);
}

const pool = getPool();
const t0 = Date.now();
try {
  const payload = await computeOwnershipHistoryCache(pool);
  const latest = payload.currentQuarter;
  const rows = latest ? payload.byQuarter[latest] ?? [] : [];
  const count = rows.length;
  if (!count) {
    console.error("No ownership history rows computed. Existing cache was not overwritten.");
    process.exitCode = 1;
  } else {
    const maxHolders = rows.reduce((m, r) => Math.max(m, r.currentHolderCount ?? 0), 0);
    if (maxHolders < 100) {
      console.error(
        "Refusing to save: max currentHolderCount in " +
          latest +
          " is only " +
          maxHolders +
          " (expected thousands). Check imported-tracked-managers.json and that 13F holdings exist for the tracked CIKs."
      );
      process.exitCode = 1;
    } else {
      saveOwnershipHistoryToDisk(payload);
      console.log(
        "Saved " +
          count +
          " tickers for " +
          (latest || "-") +
          (payload.previousQuarter ? " vs " + payload.previousQuarter : "") +
          " | max holders=" +
          maxHolders +
          " | " +
          payload.quarters.length +
          " quarter pairs | " +
          (Date.now() - t0) +
          "ms"
      );
      console.log("computedAt=" + payload.computedAt);
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}

/**
 * Precompute quarter-over-quarter institutional ownership changes.
 * Usage: npm run stocks:warm-ownership-changes
 *
 * Must be run from the same app root as the live server (where it reads
 * data/cache/ownership-changes.json). Uses the full curated + imported
 * tracked universe (batched). Requires:
 *   data/13f-info/imported-tracked-managers.json
 */
import fs from "node:fs";
import path from "node:path";
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { trackedInstitutionCiks } from "../src/institution/mostAccumulated/queries.js";
import { reloadTrackedInstitutions } from "../src/ownership/trackedInstitutions.js";
import {
  computeOwnershipChangesCache,
} from "../src/stocks/ownershipChanges/compute.js";
import { saveOwnershipChangesToDisk } from "../src/stocks/ownershipChanges/cache.js";

loadEnvFile();
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

const cachePath = path.join(process.cwd(), "data", "cache", "ownership-changes.json");
console.log(`cwd=${process.cwd()}`);
console.log(`cache → ${cachePath}`);

reloadTrackedInstitutions(true);
const cikCount = trackedInstitutionCiks().length;
console.log(`Warming ownership movers for ${cikCount} tracked institutions…`);
if (cikCount < 100) {
  console.error(
    "Tracked universe looks curated-only. Copy/import data/13f-info/imported-tracked-managers.json first."
  );
  process.exit(1);
}

const payload = await computeOwnershipChangesCache();
const latest = payload.quarters[0];
const def = payload.defaultQuarter ?? latest;
const count = def ? (payload.byQuarter[def]?.length ?? 0) : 0;
if (!count) {
  console.error("No ownership change rows computed. Existing cache was not overwritten.");
  process.exit(1);
}

const defRows = def ? payload.byQuarter[def] ?? [] : [];
const maxHolders = defRows.reduce((m, r) => Math.max(m, r.institutionCount ?? 0), 0);
if (maxHolders < 100) {
  console.error(
    `Refusing to save: max institutionCount in ${def} is only ${maxHolders} (expected thousands). ` +
      `Check imported-tracked-managers.json and that 13F holdings exist for the tracked CIKs.`
  );
  process.exit(1);
}

saveOwnershipChangesToDisk(payload);

const written = fs.existsSync(cachePath) ? fs.statSync(cachePath) : null;
console.log(
  `Ownership movers cache saved: ${payload.quarters.length} quarters, default=${def} (newest=${latest}, ${count} tickers, max holders=${maxHolders})`
);
console.log(
  `Wrote ${cachePath} (${written ? `${written.size} bytes @ ${written.mtime.toISOString()}` : "MISSING"}) computedAt=${payload.computedAt}`
);
await closePool();

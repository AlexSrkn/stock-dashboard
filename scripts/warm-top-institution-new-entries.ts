/**
 * Precompute new 13F entries from top-performing institutions.
 * Usage: npm run signals:warm-top-entries
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { computeTopInstitutionNewEntries } from "../src/signals/topInstitutionNewEntries.js";
import { saveTopInstitutionNewEntriesToDisk } from "../src/signals/topInstitutionNewEntriesCache.js";

loadEnvFile();

const payload = await computeTopInstitutionNewEntries();
saveTopInstitutionNewEntriesToDisk(payload);
console.log(
  `Top institution new entries saved: ${payload.institutions.length} funds, ${payload.entries.length} new positions → data/cache/top-institution-new-entries.json`
);
await closePool();

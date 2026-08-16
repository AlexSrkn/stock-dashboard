/**
 * Sync tracked institutions from distinct sec_filing filers already in the DB.
 * Fixes the "only ~40 institutions" directory when thousands of filers were ingested.
 *
 * Usage: npm run institutions:sync-from-db
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { ensureOwnershipSchema } from "../src/services/ownership/InstitutionDirectory.js";
import { syncTrackedInstitutionsFromDb } from "../src/ownership/syncTrackedFromDb.js";

loadEnvFile();

await ensureOwnershipSchema(getPool());
const result = await syncTrackedInstitutionsFromDb(getPool());
console.log(
  `Synced tracked institutions from DB: ${result.filersInDb} filers in sec_filing → ` +
    `${result.trackedAfter} tracked (upserted ${result.upserted} directory rows).`
);
console.log("Restart the app (systemctl restart …) if the UI still shows the old count.");

await closePool();

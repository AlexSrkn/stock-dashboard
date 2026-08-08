/**
 * Run SEC 13F pipeline and persist normalized holdings to PostgreSQL.
 *
 * Usage: npx tsx scripts/ingest-13f-db.ts [CIK] [--filings 8]
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { ingestRecent13FForCik } from "../src/sec/ingest/ingestLatest13F.js";
import { getTrackedInstitutionByCik } from "../src/ownership/trackedInstitutions.js";

loadEnvFile();

const CIK = process.argv[2] ?? "1067983";
const filingsArg = process.argv.find((a) => a === "--filings");
const filingLimit = filingsArg
  ? Math.max(1, Math.min(40, Number(process.argv[process.argv.indexOf(filingsArg) + 1]) || 8))
  : 8;

async function main() {
  const tracked = getTrackedInstitutionByCik(CIK);
  const result = await ingestRecent13FForCik(CIK, {
    fundName: tracked?.name,
    filingLimit,
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());

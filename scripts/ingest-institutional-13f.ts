/**
 * Ingest latest 13F-HR for every curated institutional filer in institutional-ciks.ts.
 *
 * Usage:
 *   npx tsx scripts/ingest-institutional-13f.ts
 *   npx tsx scripts/ingest-institutional-13f.ts --from 10 --limit 5
 *   npx tsx scripts/ingest-institutional-13f.ts --cik 1067983
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { ingestRecent13FForCik } from "../src/sec/ingest/ingestLatest13F.js";
import {
  paddedInstitutionalCik,
  TRACKED_INSTITUTIONAL_MANAGERS,
} from "../src/ownership/trackedInstitutions.js";
import { runOwnershipImport } from "../src/services/ownership/OwnershipImporter.js";

loadEnvFile();

const SEC_DELAY_MS = 250;
const DEFAULT_FILING_LIMIT = 8;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]) {
  let from = 0;
  let limit: number | null = null;
  let singleCik: string | null = null;

  let filingLimit = DEFAULT_FILING_LIMIT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from" && argv[i + 1]) {
      from = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Number(argv[++i]) || 1);
    } else if (arg === "--filings" && argv[i + 1]) {
      filingLimit = Math.max(1, Math.min(40, Number(argv[++i]) || DEFAULT_FILING_LIMIT));
    } else if (arg === "--cik" && argv[i + 1]) {
      singleCik = String(argv[++i]).replace(/\D/g, "");
    }
  }

  return { from, limit, singleCik, filingLimit };
}

async function main() {
  const { from, limit, singleCik, filingLimit } = parseArgs(process.argv.slice(2));

  let managers = [...TRACKED_INSTITUTIONAL_MANAGERS];
  if (singleCik) {
    const padded = paddedInstitutionalCik(singleCik);
    managers = managers.filter((m) => paddedInstitutionalCik(m.cik) === padded);
    if (!managers.length) {
      // Allow ad-hoc CIK ingest (e.g. backfill a combination reporter).
      managers = [{ name: `CIK ${padded}`, cik: singleCik.replace(/^0+/, "") || singleCik, type: "asset_manager" }];
    }
  } else {
    managers = managers.slice(from, limit != null ? from + limit : undefined);
  }

  if (!managers.length) {
    console.log("No managers to ingest.");
    return;
  }

  console.log(
    `Ingesting last ${filingLimit} 13F filing(s) per filer for ${managers.length} institutional filer(s)…`
  );

  const summary: Array<{
    name: string;
    cik: string;
    ok: boolean;
    filingsProcessed?: number;
    holdingsInserted?: number;
    duplicates?: number;
    error?: string;
  }> = [];

  let schemaReady = false;

  for (let i = 0; i < managers.length; i++) {
    const manager = managers[i];
    const label = `${manager.name} (CIK ${manager.cik})`;
    process.stdout.write(`[${i + 1}/${managers.length}] ${label}… `);

    try {
      const result = await ingestRecent13FForCik(manager.cik, {
        fundName: manager.name,
        ensureSchema: !schemaReady,
        filingLimit,
      });
      schemaReady = true;
      const holdingsInserted = result.results.reduce((s, r) => s + r.holdingsInserted, 0);
      const duplicates = result.results.filter((r) => r.duplicateFiling).length;
      summary.push({
        name: manager.name,
        cik: manager.cik,
        ok: true,
        filingsProcessed: result.filingsProcessed,
        holdingsInserted,
        duplicates,
      });
      console.log(
        `ok (${result.filingsProcessed} filing(s), ${holdingsInserted} holdings` +
          (duplicates ? `, ${duplicates} duplicate(s)` : "") +
          ")"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.push({ name: manager.name, cik: manager.cik, ok: false, error: message });
      console.log(`failed: ${message}`);
    }

    if (i < managers.length - 1) {
      await sleep(SEC_DELAY_MS);
    }
  }

  const ok = summary.filter((s) => s.ok).length;
  const failed = summary.length - ok;
  console.log(`\nDone: ${ok} succeeded, ${failed} failed.`);
  if (failed) {
    console.log("Failures:");
    for (const row of summary.filter((s) => !s.ok)) {
      console.log(`  - ${row.name}: ${row.error}`);
    }
    process.exitCode = 1;
  }

  const totalHoldings = summary.reduce((s, r) => s + (r.holdingsInserted ?? 0), 0);
  const skipCache = process.argv.includes("--skip-cache");
  if (ok > 0 && totalHoldings > 0 && !skipCache) {
    console.log("\nRebuilding ownership cache from latest holdings…");
    try {
      const res = await runOwnershipImport();
      console.log(
        `Ownership cache built: ${res.build.tickers} tickers, ${res.build.holdings} holdings, ` +
          `${res.institutions} institutions in ${(res.build.durationMs / 1000).toFixed(1)}s.`
      );
    } catch (err) {
      console.log(`Ownership cache rebuild failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());

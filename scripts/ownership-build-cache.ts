/**
 * Build the ownership cache (institution directory + ownership_cache + ownership_holding).
 * Heavy 13F aggregation over the full tracked universe (batched) — powers
 * /stocks/holder-overlap, held-by, and ownership screener fields.
 *
 * Requires data/13f-info/imported-tracked-managers.json (or a prior directory
 * refresh that syncs filers from sec_filing). On a 4GB VPS this can take a while.
 *
 * Usage: npm run ownership:build-cache
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { runOwnershipImport } from "../src/services/ownership/OwnershipImporter.js";

loadEnvFile();

const result = await runOwnershipImport();
console.log(
  `Ownership cache built: ${result.build.tickers} tickers, ${result.build.holdings} holdings, ` +
    `${result.institutions} institutions, quarter ${result.build.currentQuarter}` +
    ` (prev ${result.build.previousQuarter ?? "n/a"}) in ${(result.build.durationMs / 1000).toFixed(1)}s`
);

await closePool();

/**
 * Warm institution performance summaries (and optionally rebuild price returns).
 *
 * Usage:
 *   npm run performance:warm-cache              # summaries only — uses disk returns cache
 *   npm run performance:warm-cache -- --prices  # disabled (Yahoo removed); keep/restore disk cache
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { formatSecCik } from "../src/sec/http.js";
import { INSTITUTIONAL_13F_MANAGERS } from "../src/sec/seed/institutional-ciks.js";
import { savePerformanceSummariesToDisk } from "../src/institution/performance/cache.js";
import { getInstitutionPerformanceService } from "../src/institution/performance/performanceService.js";
import {
  getReturnsMatrix,
} from "../src/institution/performance/priceCache.js";

loadEnvFile();
// Full-universe holdings load exceeds the default 120s pool statement_timeout.
// Must be set before getPool() so every pooled connection inherits it.
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

const fetchPrices = process.argv.includes("--prices");
const pool = getPool();

let returnsMatrix = getReturnsMatrix();
if (fetchPrices) {
  console.error(
    "--prices is disabled (Yahoo Finance removed). Restore data/cache/ticker-quarter-returns.json instead."
  );
  process.exit(1);
} else if (!returnsMatrix) {
  console.error(
    "No ticker-quarter returns cache on disk. Restore data/cache/ticker-quarter-returns.json"
  );
  process.exit(1);
} else {
  console.log(
    `Using disk returns cache (${returnsMatrix.tickers.length} tickers, ${returnsMatrix.quarters.length} quarters).`
  );
}

const curatedCiks = INSTITUTIONAL_13F_MANAGERS.filter((m) => m.cik).map((m) =>
  formatSecCik(m.cik!)
);
const service = getInstitutionPerformanceService();
const summaries = await service.computePerformance({
  returnsMatrix,
  institutionIds: curatedCiks,
  maxHoldingsQuarters: 8,
  maxLoadQuarters: 8,
});
savePerformanceSummariesToDisk(summaries);
const instCount = new Set(summaries.map((s) => s.institutionId)).size;
console.log(
  `Performance summaries saved: ${instCount} institutions, ${summaries.length} rows → data/cache/institution-performance-summaries.json`
);

await closePool();

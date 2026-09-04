/**
 * Warm institution performance summaries (and optionally rebuild price returns).
 *
 * Default universe: full tracked institutions (curated + imported 13f.info list).
 * Batched to fit a 4GB VPS.
 *
 * Usage:
 *   npm run performance:warm-cache
 *   npm run performance:warm-cache -- --universe curated
 *   npm run performance:warm-cache -- --batch 100
 *   npm run performance:warm-cache -- --prices   # disabled (Yahoo removed)
 */
import { closePool, getPool, loadEnvFile } from "../src/db/pool.js";
import { formatSecCik } from "../src/sec/http.js";
import { INSTITUTIONAL_13F_MANAGERS } from "../src/sec/seed/institutional-ciks.js";
import {
  TRACKED_INSTITUTIONAL_CIK_PADDED,
  reloadTrackedInstitutions,
} from "../src/ownership/trackedInstitutions.js";
import { savePerformanceSummariesToDisk } from "../src/institution/performance/cache.js";
import { getInstitutionPerformanceService } from "../src/institution/performance/performanceService.js";
import { getReturnsMatrix } from "../src/institution/performance/priceCache.js";
import type { InstitutionPerformanceSummary } from "../src/institution/performance/types.js";

loadEnvFile();
// Full-universe holdings load exceeds the default 120s pool statement_timeout.
process.env.PG_STATEMENT_TIMEOUT_MS = "0";

function parseArgs(argv: string[]) {
  let universe: "tracked" | "curated" = "tracked";
  let batchSize = 120;
  const fetchPrices = argv.includes("--prices");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--universe" && argv[i + 1]) {
      const v = String(argv[++i]).toLowerCase();
      universe = v === "curated" ? "curated" : "tracked";
    } else if (arg === "--batch" && argv[i + 1]) {
      batchSize = Math.max(20, Math.min(500, Number(argv[++i]) || 120));
    }
  }
  return { universe, batchSize, fetchPrices };
}

const { universe, batchSize, fetchPrices } = parseArgs(process.argv.slice(2));
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

reloadTrackedInstitutions(true);

const ciks =
  universe === "curated"
    ? INSTITUTIONAL_13F_MANAGERS.filter((m) => m.cik).map((m) => formatSecCik(m.cik!))
    : [...TRACKED_INSTITUTIONAL_CIK_PADDED].map((c) => formatSecCik(c));

console.log(
  `Universe: ${universe} (${ciks.length} CIKs), batch size ${batchSize}`
);

const service = getInstitutionPerformanceService();
const allSummaries: InstitutionPerformanceSummary[] = [];
const totalBatches = Math.ceil(ciks.length / batchSize) || 1;

for (let i = 0; i < ciks.length; i += batchSize) {
  const batch = ciks.slice(i, i + batchSize);
  const batchNo = Math.floor(i / batchSize) + 1;
  process.stdout.write(`[${batchNo}/${totalBatches}] computing ${batch.length} institutions… `);
  const started = Date.now();
  try {
    const summaries = await service.computePerformance({
      returnsMatrix,
      institutionIds: batch,
      maxHoldingsQuarters: 8,
      maxLoadQuarters: 8,
    });
    allSummaries.push(...summaries);
    const n = new Set(summaries.map((s) => s.institutionId)).size;
    console.log(`ok (${n} with rows, ${(Date.now() - started) / 1000}s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`failed: ${message}`);
  }
}

savePerformanceSummariesToDisk(allSummaries);
const instCount = new Set(allSummaries.map((s) => s.institutionId)).size;
console.log(
  `Performance summaries saved: ${instCount} institutions, ${allSummaries.length} rows → data/cache/institution-performance-summaries.json`
);

await closePool();

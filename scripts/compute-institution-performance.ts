/**
 * Compute institutional performance summaries from cached ticker-quarter returns.
 *
 * Usage:
 *   npm run performance:warm-cache   # summaries from disk returns cache
 *   npx tsx scripts/compute-institution-performance.ts
 */
import { loadEnvFile } from "../src/db/pool.js";
import { savePerformanceSummariesToDisk } from "../src/institution/performance/cache.js";
import { getInstitutionPerformanceService } from "../src/institution/performance/index.js";
import { getReturnsMatrix } from "../src/institution/performance/priceCache.js";
import { formatSecCik } from "../src/sec/http.js";

loadEnvFile();

const cikArg = process.argv[2];

async function main() {
  if (!getReturnsMatrix()) {
    console.error("Returns cache empty. Run: npm run performance:warm-cache");
    process.exit(1);
  }
  const service = getInstitutionPerformanceService();
  const summaries = cikArg
    ? await service.computePerformanceForInstitution(formatSecCik(cikArg))
    : await service.computePerformance();

  if (!cikArg) {
    savePerformanceSummariesToDisk(summaries);
    console.log("Saved to data/cache/institution-performance-summaries.json");
  }

  const latestByInst = new Map<string, (typeof summaries)[number]>();
  for (const row of summaries) {
    latestByInst.set(row.institutionId, row);
  }

  console.log(`Institution performance rows: ${summaries.length}`);
  console.log(`Institutions: ${latestByInst.size}`);
  console.log("");

  for (const row of [...latestByInst.values()].slice(0, 15)) {
    const fmt = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);
    console.log(
      [
        row.institutionId,
        row.quarter,
        `QoQ ${fmt(row.qoqReturn)}`,
        `1Y ${fmt(row.rolling1yReturn)}`,
        `YTD ${fmt(row.ytdReturn)}`,
        `cons ${row.consistencyScore == null ? "—" : `${(row.consistencyScore * 100).toFixed(0)}%`}`,
      ].join(" · ")
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

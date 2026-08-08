/**
 * Warm the ticker-quarter returns cache (batch Yahoo fetch, once per day).
 *
 * Usage:
 *   npm run performance:warm-cache
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import { savePerformanceSummariesToDisk } from "../src/institution/performance/cache.js";
import { getInstitutionPerformanceService } from "../src/institution/performance/performanceService.js";
import { warmReturnsMatrix } from "../src/institution/performance/priceCache.js";

loadEnvFile();

await warmReturnsMatrix();

const service = getInstitutionPerformanceService();
const summaries = await service.computePerformance();
savePerformanceSummariesToDisk(summaries);
const instCount = new Set(summaries.map((s) => s.institutionId)).size;
console.log(
  `Performance summaries saved: ${instCount} institutions, ${summaries.length} rows → data/cache/institution-performance-summaries.json`
);

await closePool();

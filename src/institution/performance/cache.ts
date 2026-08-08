import fs from "node:fs";
import path from "node:path";
import type { InstitutionPerformanceSummary } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "institution-performance-summaries.json");
/** In-process TTL after a fresh compute; disk cache is used across restarts. */
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload {
  version: 1;
  builtAt: string;
  summaries: InstitutionPerformanceSummary[];
}

let cache: { loadedAt: number; summaries: InstitutionPerformanceSummary[] } | null = null;
let inflight: Promise<InstitutionPerformanceSummary[]> | null = null;

function hydrateMemory(summaries: InstitutionPerformanceSummary[], loadedAt: number): void {
  cache = { loadedAt, summaries };
}

export function loadPerformanceSummariesFromDisk(): InstitutionPerformanceSummary[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.summaries) || !raw.summaries.length) {
      return null;
    }
    return raw.summaries;
  } catch {
    return null;
  }
}

export function savePerformanceSummariesToDisk(summaries: InstitutionPerformanceSummary[]): void {
  if (!summaries.length) {
    console.warn("Refusing to save empty performance summaries cache (existing file preserved).");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const payload: DiskPayload = {
    version: 1,
    builtAt: new Date().toISOString(),
    summaries,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

/** Synchronous startup load — no DB work on npm start. */
export function ensurePerformanceSummariesOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("Performance summaries cache missing — run: npm run performance:warm-cache");
      return;
    }
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw?.summaries?.length) {
      console.log("Performance summaries cache empty — run: npm run performance:warm-cache");
      return;
    }
    hydrateMemory(raw.summaries, Date.now());
    const instCount = new Set(raw.summaries.map((s) => s.institutionId)).size;
    console.log(
      `Performance summaries cache loaded (${instCount} institutions, ${raw.summaries.length} rows).`
    );
  } catch (err) {
    console.warn(
      "Performance summaries cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedPerformanceSummaries(): InstitutionPerformanceSummary[] | null {
  if (cache && !cache.summaries.length) cache = null;

  if (!cache) {
    const disk = loadPerformanceSummariesFromDisk();
    if (disk?.length) hydrateMemory(disk, Date.now());
  }
  if (!cache?.summaries.length) return null;
  if (Date.now() - cache.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadPerformanceSummariesFromDisk();
    if (disk?.length) {
      hydrateMemory(disk, Date.now());
      return cache.summaries;
    }
    return null;
  }
  return cache.summaries;
}

export function setCachedPerformanceSummaries(summaries: InstitutionPerformanceSummary[]): void {
  hydrateMemory(summaries, Date.now());
}

export function clearPerformanceCache(): void {
  cache = null;
  inflight = null;
}

export async function getOrComputePerformanceSummaries(
  compute: () => Promise<InstitutionPerformanceSummary[]>
): Promise<InstitutionPerformanceSummary[]> {
  const hit = getCachedPerformanceSummaries();
  if (hit?.length) return hit;

  if (inflight) return inflight;

  inflight = compute()
    .then((summaries) => {
      if (summaries.length) {
        hydrateMemory(summaries, Date.now());
        savePerformanceSummariesToDisk(summaries);
      }
      return summaries;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

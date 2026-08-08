import fs from "node:fs";
import path from "node:path";
import type { CompletelySoldPayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "institutional-completely-sold.json");

interface DiskPayload extends CompletelySoldPayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: CompletelySoldPayload } | null = null;
const MEMORY_CACHE_MS = 15 * 60 * 1000;

export function loadCompletelySoldFromDisk(): CompletelySoldPayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.positions)) return null;
    return {
      computedAt: raw.computedAt,
      quarters: Array.isArray(raw.quarters) ? raw.quarters : [],
      sectors: Array.isArray(raw.sectors) ? raw.sectors : [],
      institutions: Array.isArray(raw.institutions) ? raw.institutions : [],
      summary: raw.summary,
      positions: raw.positions,
    };
  } catch {
    return null;
  }
}

export function saveCompletelySoldToDisk(payload: CompletelySoldPayload): void {
  if (!payload.positions.length) {
    console.warn("Refusing to save empty institutional completely-sold cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureCompletelySoldCacheOnStartup(): void {
  const payload = loadCompletelySoldFromDisk();
  if (!payload) {
    console.log(
      "Institutional completely sold cache missing — run: npm run institutions:warm-completely-sold"
    );
    return;
  }
  memoryCache = { loadedAt: Date.now(), payload };
  console.log(
    `Institutional completely sold cache loaded (${payload.positions.length} positions, ${payload.summary.institutionsReporting} institutions).`
  );
}

export function getCachedCompletelySold(): CompletelySoldPayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const disk = loadCompletelySoldFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return disk;
}

export function setCompletelySoldMemoryCache(payload: CompletelySoldPayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

import fs from "node:fs";
import path from "node:path";
import type { NewPositionsPayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "institutional-new-positions.json");

interface DiskPayload extends NewPositionsPayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: NewPositionsPayload } | null = null;
const MEMORY_CACHE_MS = 15 * 60 * 1000;

export function loadNewPositionsFromDisk(): NewPositionsPayload | null {
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

export function saveNewPositionsToDisk(payload: NewPositionsPayload): void {
  if (!payload.positions.length) {
    console.warn("Refusing to save empty institutional new-positions cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureNewPositionsCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log(
        "Institutional new positions cache missing — run: npm run institutions:warm-new-positions"
      );
      return;
    }
    // Do not hydrate at boot — this file is often 100MB+ on disk and much larger in heap.
    const mb = fs.statSync(CACHE_FILE).size / (1024 * 1024);
    console.log(
      `Institutional new positions cache on disk (${mb.toFixed(1)} MB) — lazy-loaded on first request.`
    );
  } catch (err) {
    console.warn(
      "Institutional new positions cache check failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedNewPositions(): NewPositionsPayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const disk = loadNewPositionsFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return disk;
}

export function setNewPositionsMemoryCache(payload: NewPositionsPayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

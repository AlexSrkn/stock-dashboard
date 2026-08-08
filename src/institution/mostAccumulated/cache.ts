import fs from "node:fs";
import path from "node:path";
import type { MostAccumulatedPayload, MostAccumulatedPeriod } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "most-accumulated.json");

interface DiskPayload extends MostAccumulatedPayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: MostAccumulatedPayload } | null = null;
const MEMORY_CACHE_MS = 15 * 60 * 1000;

export function loadMostAccumulatedFromDisk(): MostAccumulatedPayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !raw.periods) return null;
    return {
      computedAt: raw.computedAt,
      sectors: Array.isArray(raw.sectors) ? raw.sectors : [],
      periods: raw.periods,
    };
  } catch {
    return null;
  }
}

export function saveMostAccumulatedToDisk(payload: MostAccumulatedPayload): void {
  const hasRows = Object.values(payload.periods).some((p) => p.stocks.length > 0);
  if (!hasRows) {
    console.warn("Refusing to save empty most-accumulated cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureMostAccumulatedCacheOnStartup(): void {
  const payload = loadMostAccumulatedFromDisk();
  if (!payload) {
    console.log("Most accumulated cache missing — run: npm run institutions:warm-most-accumulated");
    return;
  }
  memoryCache = { loadedAt: Date.now(), payload };
  const quarterCount = payload.periods.quarter?.stocks?.length ?? 0;
  console.log(`Most accumulated cache loaded (${quarterCount} tickers, quarter period).`);
}

export function getCachedMostAccumulated(): MostAccumulatedPayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const disk = loadMostAccumulatedFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return disk;
}

export function setMostAccumulatedMemoryCache(payload: MostAccumulatedPayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

export function parseMostAccumulatedPeriod(raw: string | null): MostAccumulatedPeriod {
  if (raw === "30d" || raw === "year") return raw;
  return "quarter";
}

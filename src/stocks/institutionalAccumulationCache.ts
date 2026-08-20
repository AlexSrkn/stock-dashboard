import fs from "node:fs";
import path from "node:path";
import type { InstitutionalAccumulationPayload } from "./institutionalAccumulationTypes.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "institutional-accumulation.json");

interface DiskPayload extends InstitutionalAccumulationPayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: InstitutionalAccumulationPayload } | null = null;
const MEMORY_CACHE_MS = 15 * 60 * 1000;

export function loadInstitutionalAccumulationFromDisk(): InstitutionalAccumulationPayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.stocks)) return null;
    return {
      computedAt: raw.computedAt,
      currentQuarter: raw.currentQuarter,
      previousQuarter: raw.previousQuarter,
      count: raw.count,
      stocks: raw.stocks,
    };
  } catch {
    return null;
  }
}

export function saveInstitutionalAccumulationToDisk(payload: InstitutionalAccumulationPayload): void {
  if (!payload.stocks.length) {
    console.warn("Refusing to save empty institutional accumulation cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureInstitutionalAccumulationCacheOnStartup(): void {
  const payload = loadInstitutionalAccumulationFromDisk();
  if (!payload) {
    console.log("Institutional accumulation cache missing — run: npm run stocks:warm-institutional-accumulation");
    return;
  }
  memoryCache = { loadedAt: Date.now(), payload };
  console.log(
    `Institutional accumulation cache loaded (${payload.stocks.length} tickers, ${payload.currentQuarter}).`
  );
}

export function getCachedInstitutionalAccumulation(limit = 100): InstitutionalAccumulationPayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return slicePayload(memoryCache.payload, limit);
  }
  const disk = loadInstitutionalAccumulationFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return slicePayload(disk, limit);
}

function slicePayload(payload: InstitutionalAccumulationPayload, limit: number): InstitutionalAccumulationPayload {
  const stocks = payload.stocks.slice(0, Math.max(1, limit));
  // Keep total universe size in `count` (hub card); `stocks` is the page slice.
  return { ...payload, count: payload.stocks.length, stocks };
}

export function setInstitutionalAccumulationMemoryCache(payload: InstitutionalAccumulationPayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

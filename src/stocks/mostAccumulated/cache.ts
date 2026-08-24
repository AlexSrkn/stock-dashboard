import fs from "node:fs";
import path from "node:path";
import { loadMostAccumulatedFromDisk } from "../../institution/mostAccumulated/cache.js";
import type { StocksMostAccumulatedCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "stocks-most-accumulated.json");
const MEMORY_CACHE_MS = 15 * 60 * 1000;

interface DiskPayload extends StocksMostAccumulatedCachePayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: StocksMostAccumulatedCachePayload } | null = null;
let inflight: Promise<StocksMostAccumulatedCachePayload> | null = null;

function isValidCache(raw: DiskPayload | null | undefined): raw is DiskPayload {
  return Boolean(
    raw &&
      raw.version === 1 &&
      raw.periods?.["30d"] &&
      raw.periods?.["90d"] &&
      raw.periods?.year
  );
}

export function loadStocksMostAccumulatedFromDisk(): StocksMostAccumulatedCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!isValidCache(raw)) return null;
    return {
      computedAt: raw.computedAt,
      periods: raw.periods,
    };
  } catch {
    return null;
  }
}

export function saveStocksMostAccumulatedToDisk(payload: StocksMostAccumulatedCachePayload): void {
  const rowCount = Object.values(payload.periods).reduce((sum, p) => sum + (p.stocks?.length ?? 0), 0);
  if (!rowCount) {
    console.warn("Refusing to save empty stocks most-accumulated cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureStocksMostAccumulatedCacheOnStartup(): void {
  const payload = loadStocksMostAccumulatedFromDisk();
  if (!payload) {
    console.log("Stocks most-accumulated cache missing — run: npm run stocks:warm-most-accumulated");
    return;
  }
  memoryCache = { loadedAt: Date.now(), payload };
  const count = payload.periods["90d"]?.stocks?.length ?? 0;
  const avgBuyers90 = averageBuyerCount(payload.periods["90d"]?.stocks);
  console.log(
    `Stocks most-accumulated cache loaded (${count} tickers, 90d, avg buyers=${avgBuyers90.toFixed(1)}).`
  );
  const inst = loadMostAccumulatedFromDisk();
  if (inst?.computedAt && payload.computedAt && inst.computedAt > payload.computedAt) {
    console.warn(
      `Stocks most-accumulated cache is older than the institutions cache (${payload.computedAt} vs ${inst.computedAt}). Run: npm run stocks:warm-most-accumulated`
    );
  }
}

function averageBuyerCount(
  stocks: StocksMostAccumulatedCachePayload["periods"]["90d"]["stocks"] | undefined
): number {
  if (!stocks?.length) return 0;
  return stocks.reduce((s, r) => s + (r.buyerCount ?? 0), 0) / stocks.length;
}

export function getCachedStocksMostAccumulated(): StocksMostAccumulatedCachePayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const disk = loadStocksMostAccumulatedFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return disk;
}

export function setStocksMostAccumulatedMemoryCache(payload: StocksMostAccumulatedCachePayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

export async function getOrComputeStocksMostAccumulated(
  compute: () => Promise<StocksMostAccumulatedCachePayload>
): Promise<StocksMostAccumulatedCachePayload> {
  const hit = getCachedStocksMostAccumulated();
  if (hit) return hit;
  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      const rowCount = Object.values(payload.periods).reduce((s, p) => s + (p.stocks?.length ?? 0), 0);
      if (rowCount > 0) {
        setStocksMostAccumulatedMemoryCache(payload);
        saveStocksMostAccumulatedToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

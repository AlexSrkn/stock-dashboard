import fs from "node:fs";
import path from "node:path";
import type { OwnershipHistoryCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "ownership-history.json");
const MEMORY_CACHE_MS = 15 * 60 * 1000;

interface DiskPayload extends OwnershipHistoryCachePayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: OwnershipHistoryCachePayload } | null = null;
let inflight: Promise<OwnershipHistoryCachePayload> | null = null;

export function loadOwnershipHistoryFromDisk(): OwnershipHistoryCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !raw.byQuarter) return null;
    return {
      computedAt: raw.computedAt,
      currentQuarter: raw.currentQuarter,
      previousQuarter: raw.previousQuarter,
      quarters: Array.isArray(raw.quarters) ? raw.quarters : [],
      sectors: Array.isArray(raw.sectors) ? raw.sectors : [],
      byQuarter: raw.byQuarter,
    };
  } catch {
    return null;
  }
}

export function saveOwnershipHistoryToDisk(payload: OwnershipHistoryCachePayload): void {
  const rowCount = Object.values(payload.byQuarter).reduce((sum, rows) => sum + rows.length, 0);
  if (!rowCount) {
    console.warn("Refusing to save empty ownership-history cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureOwnershipHistoryCacheOnStartup(): void {
  const payload = loadOwnershipHistoryFromDisk();
  if (!payload) {
    console.log("Ownership history cache missing — run: npm run stocks:warm-ownership-history");
    return;
  }
  memoryCache = { loadedAt: Date.now(), payload };
  const latest = payload.currentQuarter;
  const count = latest ? (payload.byQuarter[latest]?.length ?? 0) : 0;
  console.log(`Ownership history cache loaded (${count} tickers, ${latest ?? "—"}).`);
}

export function getCachedOwnershipHistory(): OwnershipHistoryCachePayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const disk = loadOwnershipHistoryFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return disk;
}

export function setOwnershipHistoryMemoryCache(payload: OwnershipHistoryCachePayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

export async function getOrComputeOwnershipHistory(
  compute: () => Promise<OwnershipHistoryCachePayload>
): Promise<OwnershipHistoryCachePayload> {
  const hit = getCachedOwnershipHistory();
  if (hit) return hit;
  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      const rowCount = Object.values(payload.byQuarter).reduce((s, r) => s + r.length, 0);
      if (rowCount > 0) {
        setOwnershipHistoryMemoryCache(payload);
        saveOwnershipHistoryToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

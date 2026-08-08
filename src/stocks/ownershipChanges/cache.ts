import fs from "node:fs";
import path from "node:path";
import type { OwnershipChangesCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "ownership-changes.json");

interface DiskPayload extends OwnershipChangesCachePayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: OwnershipChangesCachePayload } | null = null;
const MEMORY_CACHE_MS = 15 * 60 * 1000;

export function loadOwnershipChangesFromDisk(): OwnershipChangesCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !raw.byQuarter) return null;
    return {
      computedAt: raw.computedAt,
      quarters: Array.isArray(raw.quarters) ? raw.quarters : [],
      sectors: Array.isArray(raw.sectors) ? raw.sectors : [],
      exchanges: Array.isArray(raw.exchanges) ? raw.exchanges : [],
      byQuarter: raw.byQuarter,
    };
  } catch {
    return null;
  }
}

export function saveOwnershipChangesToDisk(payload: OwnershipChangesCachePayload): void {
  const rowCount = Object.values(payload.byQuarter).reduce((sum, rows) => sum + rows.length, 0);
  if (!rowCount) {
    console.warn("Refusing to save empty ownership-changes cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureOwnershipChangesCacheOnStartup(): void {
  const payload = loadOwnershipChangesFromDisk();
  if (!payload) {
    console.log("Ownership changes cache missing — run: npm run stocks:warm-ownership-changes");
    return;
  }
  memoryCache = { loadedAt: Date.now(), payload };
  const latest = payload.quarters[0];
  const count = latest ? (payload.byQuarter[latest]?.length ?? 0) : 0;
  console.log(`Ownership changes cache loaded (${count} tickers, ${latest ?? "—"}).`);
}

export function getCachedOwnershipChanges(): OwnershipChangesCachePayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const disk = loadOwnershipChangesFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return disk;
}

export function setOwnershipChangesMemoryCache(payload: OwnershipChangesCachePayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

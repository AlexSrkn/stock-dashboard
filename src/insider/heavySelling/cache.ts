import fs from "node:fs";
import path from "node:path";
import type { HeavySellingCachePayload, HeavySellingRow } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "heavy-selling.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

type MemoryEntry = {
  loadedAt: number;
  payload: HeavySellingCachePayload;
};

let memory: MemoryEntry | null = null;
let inflight: Promise<HeavySellingCachePayload> | null = null;

export function loadHeavySellingFromDisk(): HeavySellingCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as HeavySellingCachePayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.rows)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveHeavySellingToDisk(payload: HeavySellingCachePayload): void {
  if (!payload.rows.length) {
    console.warn("Refusing to save empty heavy selling cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

function hydrateMemory(payload: HeavySellingCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function ensureHeavySellingCacheOnStartup(): void {
  try {
    const disk = loadHeavySellingFromDisk();
    if (!disk?.rows.length) {
      console.log("Heavy selling cache missing — run: npm run insiders:warm-heavy-selling");
      return;
    }
    hydrateMemory(disk);
    console.log(`Heavy selling cache loaded (${disk.rows.length} tickers).`);
  } catch (err) {
    console.warn(
      "Heavy selling cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedHeavySelling(): HeavySellingCachePayload | null {
  if (memory && Date.now() - memory.loadedAt < MEMORY_CACHE_MS) return memory.payload;
  const disk = loadHeavySellingFromDisk();
  if (disk?.rows.length) {
    hydrateMemory(disk);
    return disk;
  }
  return memory?.payload ?? null;
}

export async function getOrComputeHeavySelling(
  compute: () => Promise<HeavySellingCachePayload>
): Promise<HeavySellingCachePayload> {
  const cached = getCachedHeavySelling();
  if (cached?.rows.length) return cached;

  if (inflight) return inflight;
  inflight = (async () => {
    const payload = await compute();
    if (payload.rows.length) {
      saveHeavySellingToDisk(payload);
      hydrateMemory(payload);
    }
    return payload;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function getCachedHeavySellingRows(): HeavySellingRow[] {
  return getCachedHeavySelling()?.rows ?? [];
}

export function invalidateHeavySellingCache(): void {
  memory = null;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    /* ignore */
  }
}

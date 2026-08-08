import fs from "node:fs";
import path from "node:path";
import type { FirstTimeBuyerRow, FirstTimeBuyersCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "first-time-buyers.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

type MemoryEntry = {
  loadedAt: number;
  payload: FirstTimeBuyersCachePayload;
};

let memory: MemoryEntry | null = null;
let inflight: Promise<FirstTimeBuyersCachePayload> | null = null;

export function loadFirstTimeBuyersFromDisk(): FirstTimeBuyersCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as FirstTimeBuyersCachePayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.rows)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveFirstTimeBuyersToDisk(payload: FirstTimeBuyersCachePayload): void {
  if (!payload.rows.length) {
    console.warn("Refusing to save empty first-time buyers cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

function hydrateMemory(payload: FirstTimeBuyersCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function ensureFirstTimeBuyersCacheOnStartup(): void {
  try {
    const disk = loadFirstTimeBuyersFromDisk();
    if (!disk?.rows.length) {
      console.log("First-time buyers cache missing — run: npm run insiders:warm-first-time-buyers");
      return;
    }
    hydrateMemory(disk);
    console.log(`First-time buyers cache loaded (${disk.rows.length} trades).`);
  } catch (err) {
    console.warn(
      "First-time buyers cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedFirstTimeBuyers(): FirstTimeBuyersCachePayload | null {
  if (memory && Date.now() - memory.loadedAt < MEMORY_CACHE_MS) return memory.payload;
  const disk = loadFirstTimeBuyersFromDisk();
  if (disk?.rows.length) {
    hydrateMemory(disk);
    return disk;
  }
  return memory?.payload ?? null;
}

export async function getOrComputeFirstTimeBuyers(
  compute: () => Promise<FirstTimeBuyersCachePayload>
): Promise<FirstTimeBuyersCachePayload> {
  const cached = getCachedFirstTimeBuyers();
  if (cached?.rows.length) return cached;

  if (inflight) return inflight;
  inflight = (async () => {
    const payload = await compute();
    if (payload.rows.length) {
      saveFirstTimeBuyersToDisk(payload);
      hydrateMemory(payload);
    }
    return payload;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function getCachedFirstTimeBuyerRows(): FirstTimeBuyerRow[] {
  return getCachedFirstTimeBuyers()?.rows ?? [];
}

export function invalidateFirstTimeBuyersCache(): void {
  memory = null;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    /* ignore */
  }
}

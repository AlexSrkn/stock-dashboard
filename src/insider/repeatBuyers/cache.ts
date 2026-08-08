import fs from "node:fs";
import path from "node:path";
import type { RepeatBuyerRow, RepeatBuyersCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "repeat-buyers.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

type MemoryEntry = {
  loadedAt: number;
  payload: RepeatBuyersCachePayload;
};

let memory: MemoryEntry | null = null;
let inflight: Promise<RepeatBuyersCachePayload> | null = null;

export function loadRepeatBuyersFromDisk(): RepeatBuyersCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as RepeatBuyersCachePayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.rows)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveRepeatBuyersToDisk(payload: RepeatBuyersCachePayload): void {
  if (!payload.rows.length) {
    console.warn("Refusing to save empty repeat buyers cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

function hydrateMemory(payload: RepeatBuyersCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function ensureRepeatBuyersCacheOnStartup(): void {
  try {
    const disk = loadRepeatBuyersFromDisk();
    if (!disk?.rows.length) {
      console.log("Repeat buyers cache missing — run: npm run insiders:warm-repeat-buyers");
      return;
    }
    hydrateMemory(disk);
    console.log(`Repeat buyers cache loaded (${disk.rows.length} insider/ticker pairs).`);
  } catch (err) {
    console.warn(
      "Repeat buyers cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedRepeatBuyers(): RepeatBuyersCachePayload | null {
  if (memory && Date.now() - memory.loadedAt < MEMORY_CACHE_MS) return memory.payload;
  const disk = loadRepeatBuyersFromDisk();
  if (disk?.rows.length) {
    hydrateMemory(disk);
    return disk;
  }
  return memory?.payload ?? null;
}

export async function getOrComputeRepeatBuyers(
  compute: () => Promise<RepeatBuyersCachePayload>
): Promise<RepeatBuyersCachePayload> {
  const cached = getCachedRepeatBuyers();
  if (cached?.rows.length) return cached;

  if (inflight) return inflight;
  inflight = (async () => {
    const payload = await compute();
    if (payload.rows.length) {
      saveRepeatBuyersToDisk(payload);
      hydrateMemory(payload);
    }
    return payload;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function getCachedRepeatBuyerRows(): RepeatBuyerRow[] {
  return getCachedRepeatBuyers()?.rows ?? [];
}

/** Drop memory + disk cache so the next request recomputes after new Form 4 rows. */
export function invalidateRepeatBuyersCache(): void {
  memory = null;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    /* ignore */
  }
}

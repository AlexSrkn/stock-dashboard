import fs from "node:fs";
import path from "node:path";
import type { ConvictionBuyRow, ConvictionBuysCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "conviction-buys.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

type MemoryEntry = {
  loadedAt: number;
  payload: ConvictionBuysCachePayload;
};

let memory: MemoryEntry | null = null;
let inflight: Promise<ConvictionBuysCachePayload> | null = null;

export function loadConvictionBuysFromDisk(): ConvictionBuysCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as ConvictionBuysCachePayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.rows)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveConvictionBuysToDisk(payload: ConvictionBuysCachePayload): void {
  if (!payload.rows.length) {
    console.warn("Refusing to save empty conviction buys cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

function hydrateMemory(payload: ConvictionBuysCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function ensureConvictionBuysCacheOnStartup(): void {
  try {
    const disk = loadConvictionBuysFromDisk();
    if (!disk?.rows.length) {
      console.log("Conviction buys cache missing — run: npm run insiders:warm-conviction-buys");
      return;
    }
    hydrateMemory(disk);
    console.log(`Conviction buys cache loaded (${disk.rows.length} trades).`);
  } catch (err) {
    console.warn(
      "Conviction buys cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedConvictionBuys(): ConvictionBuysCachePayload | null {
  if (memory && Date.now() - memory.loadedAt < MEMORY_CACHE_MS) return memory.payload;
  const disk = loadConvictionBuysFromDisk();
  if (disk?.rows.length) {
    hydrateMemory(disk);
    return disk;
  }
  return memory?.payload ?? null;
}

export async function getOrComputeConvictionBuys(
  compute: () => Promise<ConvictionBuysCachePayload>
): Promise<ConvictionBuysCachePayload> {
  const cached = getCachedConvictionBuys();
  if (cached?.rows.length) return cached;

  if (inflight) return inflight;
  inflight = (async () => {
    const payload = await compute();
    if (payload.rows.length) {
      saveConvictionBuysToDisk(payload);
      hydrateMemory(payload);
    }
    return payload;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function getCachedConvictionBuyRows(): ConvictionBuyRow[] {
  return getCachedConvictionBuys()?.rows ?? [];
}

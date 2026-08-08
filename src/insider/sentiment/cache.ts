import fs from "node:fs";
import path from "node:path";
import type { InsiderSentimentCachePayload, InsiderSentimentRow } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "insider-sentiment.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

type MemoryEntry = {
  loadedAt: number;
  payload: InsiderSentimentCachePayload;
};

let memory: MemoryEntry | null = null;
let inflight: Promise<InsiderSentimentCachePayload> | null = null;

export function loadInsiderSentimentFromDisk(): InsiderSentimentCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as InsiderSentimentCachePayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.rows)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveInsiderSentimentToDisk(payload: InsiderSentimentCachePayload): void {
  if (!payload.rows.length) {
    console.warn("Refusing to save empty insider sentiment cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

function hydrateMemory(payload: InsiderSentimentCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function ensureInsiderSentimentCacheOnStartup(): void {
  try {
    const disk = loadInsiderSentimentFromDisk();
    if (!disk?.rows.length) {
      console.log("Insider sentiment cache missing — run: npm run insiders:warm-sentiment");
      return;
    }
    hydrateMemory(disk);
    console.log(`Insider sentiment cache loaded (${disk.rows.length} tickers).`);
  } catch (err) {
    console.warn(
      "Insider sentiment cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedInsiderSentiment(): InsiderSentimentCachePayload | null {
  if (memory && Date.now() - memory.loadedAt < MEMORY_CACHE_MS) return memory.payload;
  const disk = loadInsiderSentimentFromDisk();
  if (disk?.rows.length) {
    hydrateMemory(disk);
    return disk;
  }
  return memory?.payload ?? null;
}

export async function getOrComputeInsiderSentiment(
  compute: () => Promise<InsiderSentimentCachePayload>
): Promise<InsiderSentimentCachePayload> {
  const cached = getCachedInsiderSentiment();
  if (cached?.rows.length) return cached;

  if (inflight) return inflight;
  inflight = (async () => {
    const payload = await compute();
    if (payload.rows.length) {
      saveInsiderSentimentToDisk(payload);
      hydrateMemory(payload);
    }
    return payload;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function getCachedInsiderSentimentRows(): InsiderSentimentRow[] {
  return getCachedInsiderSentiment()?.rows ?? [];
}

export function invalidateInsiderSentimentCache(): void {
  memory = null;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    /* ignore */
  }
}

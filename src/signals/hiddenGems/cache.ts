import fs from "node:fs";
import path from "node:path";
import type { HiddenGemsCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "hidden-gems.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload extends HiddenGemsCachePayload {
  version: 1;
  builtAt: string;
}

let memory: { loadedAt: number; payload: HiddenGemsCachePayload } | null = null;
let inflight: Promise<HiddenGemsCachePayload> | null = null;

function hydrateMemory(payload: HiddenGemsCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function loadHiddenGemsFromDisk(): HiddenGemsCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.signals)) return null;
    const { version: _v, builtAt: _b, ...payload } = raw;
    return payload;
  } catch {
    return null;
  }
}

export function saveHiddenGemsToDisk(payload: HiddenGemsCachePayload): void {
  if (!payload.signals.length) {
    console.warn("Refusing to save empty hidden-gems cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = {
    version: 1,
    builtAt: new Date().toISOString(),
    ...payload,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureHiddenGemsCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("Hidden gems cache missing — run: npm run signals:warm-hidden-gems");
      return;
    }
    const payload = loadHiddenGemsFromDisk();
    if (!payload?.signals?.length) return;
    hydrateMemory(payload);
    console.log(`Hidden gems cache loaded (${payload.signals.length} signals).`);
  } catch (err) {
    console.warn(
      "Hidden gems cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedHiddenGems(): HiddenGemsCachePayload | null {
  if (!memory) {
    const disk = loadHiddenGemsFromDisk();
    if (disk) hydrateMemory(disk);
  }
  if (!memory) return null;
  if (Date.now() - memory.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadHiddenGemsFromDisk();
    if (disk) {
      hydrateMemory(disk);
      return memory.payload;
    }
    return null;
  }
  return memory.payload;
}

export async function getOrComputeHiddenGems(
  compute: () => Promise<HiddenGemsCachePayload>
): Promise<HiddenGemsCachePayload> {
  const hit = getCachedHiddenGems();
  if (hit) return hit;

  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      if (payload.signals.length) {
        hydrateMemory(payload);
        saveHiddenGemsToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}


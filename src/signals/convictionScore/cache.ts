import fs from "node:fs";
import path from "node:path";
import type { ConvictionScoreCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "conviction-score.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload extends ConvictionScoreCachePayload {
  builtAt: string;
}

let memory: { loadedAt: number; payload: ConvictionScoreCachePayload } | null = null;
let inflight: Promise<ConvictionScoreCachePayload> | null = null;

function hydrateMemory(payload: ConvictionScoreCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function loadConvictionScoreFromDisk(): ConvictionScoreCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.signals)) return null;
    const { builtAt: _b, ...payload } = raw;
    return payload;
  } catch {
    return null;
  }
}

export function saveConvictionScoreToDisk(payload: ConvictionScoreCachePayload): void {
  const scored = payload.signals.filter((s) => !s.insufficientData && s.convictionScore != null);
  if (!scored.length) {
    console.warn("Refusing to save empty conviction-score cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = {
    builtAt: new Date().toISOString(),
    ...payload,
    version: 1,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureConvictionScoreCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("Conviction score cache missing — run: npm run signals:warm-conviction-score");
      return;
    }
    const payload = loadConvictionScoreFromDisk();
    if (!payload?.signals?.length) return;
    hydrateMemory(payload);
    const scored = payload.signals.filter((s) => !s.insufficientData).length;
    console.log(`Conviction score cache loaded (${scored} scored stocks).`);
  } catch (err) {
    console.warn(
      "Conviction score cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedConvictionScore(): ConvictionScoreCachePayload | null {
  if (!memory) {
    const disk = loadConvictionScoreFromDisk();
    if (disk) hydrateMemory(disk);
  }
  if (!memory) return null;
  if (Date.now() - memory.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadConvictionScoreFromDisk();
    if (disk) {
      hydrateMemory(disk);
      return memory.payload;
    }
    return null;
  }
  return memory.payload;
}

export async function getOrComputeConvictionScore(
  compute: () => Promise<ConvictionScoreCachePayload>
): Promise<ConvictionScoreCachePayload> {
  const hit = getCachedConvictionScore();
  if (hit) return hit;

  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      const scored = payload.signals.filter((s) => !s.insufficientData && s.convictionScore != null);
      if (scored.length) {
        hydrateMemory(payload);
        saveConvictionScoreToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

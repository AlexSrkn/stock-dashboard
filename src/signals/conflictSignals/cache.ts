import fs from "node:fs";
import path from "node:path";
import type { ConflictSignalsCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "conflict-signals.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload extends ConflictSignalsCachePayload {
  version: 1;
  builtAt: string;
}

let memory: { loadedAt: number; payload: ConflictSignalsCachePayload } | null = null;
let inflight: Promise<ConflictSignalsCachePayload> | null = null;

function hydrateMemory(payload: ConflictSignalsCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function loadConflictSignalsFromDisk(): ConflictSignalsCachePayload | null {
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

export function saveConflictSignalsToDisk(payload: ConflictSignalsCachePayload): void {
  if (!payload.signals.length) {
    console.warn("Refusing to save empty conflict-signals cache.");
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

export function ensureConflictSignalsCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("Conflict signals cache missing — run: npm run signals:warm-conflict-signals");
      return;
    }
    const payload = loadConflictSignalsFromDisk();
    if (!payload?.signals?.length) return;
    hydrateMemory(payload);
    console.log(`Conflict signals cache loaded (${payload.signals.length} signals).`);
  } catch (err) {
    console.warn(
      "Conflict signals cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedConflictSignals(): ConflictSignalsCachePayload | null {
  if (!memory) {
    const disk = loadConflictSignalsFromDisk();
    if (disk) hydrateMemory(disk);
  }
  if (!memory) return null;
  if (Date.now() - memory.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadConflictSignalsFromDisk();
    if (disk) {
      hydrateMemory(disk);
      return memory.payload;
    }
    return null;
  }
  return memory.payload;
}

export function setConflictSignalsMemoryCache(payload: ConflictSignalsCachePayload): void {
  hydrateMemory(payload);
}

export async function getOrComputeConflictSignals(
  compute: () => Promise<ConflictSignalsCachePayload>
): Promise<ConflictSignalsCachePayload> {
  const hit = getCachedConflictSignals();
  if (hit) return hit;

  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      if (payload.signals.length) {
        hydrateMemory(payload);
        saveConflictSignalsToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}


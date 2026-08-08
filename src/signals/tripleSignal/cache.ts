import fs from "node:fs";
import path from "node:path";
import type { TripleSignalPayload, TripleSignalWindowDays } from "./types.js";
import { TRIPLE_SIGNAL_WINDOW_OPTIONS } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload extends TripleSignalPayload {
  version: 1;
  builtAt: string;
}

function cacheFileForWindow(windowDays: TripleSignalWindowDays): string {
  return path.join(CACHE_DIR, `triple-signal-${windowDays}d.json`);
}

const memory = new Map<
  TripleSignalWindowDays,
  { loadedAt: number; payload: TripleSignalPayload }
>();
const inflight = new Map<TripleSignalWindowDays, Promise<TripleSignalPayload>>();

function hydrateMemory(windowDays: TripleSignalWindowDays, payload: TripleSignalPayload): void {
  memory.set(windowDays, { loadedAt: Date.now(), payload });
}

export function loadTripleSignalFromDisk(
  windowDays: TripleSignalWindowDays
): TripleSignalPayload | null {
  try {
    const file = cacheFileForWindow(windowDays);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.signals)) return null;
    const { version: _v, builtAt: _b, ...payload } = raw;
    return payload;
  } catch {
    return null;
  }
}

export function saveTripleSignalToDisk(payload: TripleSignalPayload): void {
  if (!payload.signals.length) {
    console.warn(`Refusing to save empty triple-signal cache (${payload.windowDays}d).`);
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = {
    version: 1,
    builtAt: new Date().toISOString(),
    ...payload,
  };
  fs.writeFileSync(cacheFileForWindow(payload.windowDays), JSON.stringify(disk), "utf8");
}

export function ensureTripleSignalCacheOnStartup(): void {
  for (const windowDays of TRIPLE_SIGNAL_WINDOW_OPTIONS) {
    try {
      const file = cacheFileForWindow(windowDays);
      if (!fs.existsSync(file)) {
        console.log(
          `Triple signal cache missing (${windowDays}d) — run: npm run signals:warm-triple-signal`
        );
        continue;
      }
      const payload = loadTripleSignalFromDisk(windowDays);
      if (!payload?.signals?.length) continue;
      hydrateMemory(windowDays, payload);
      console.log(
        `Triple signal cache loaded (${windowDays}d, ${payload.signals.length} signals).`
      );
    } catch (err) {
      console.warn(
        `Triple signal cache load failed (${windowDays}d):`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

export function getCachedTripleSignal(
  windowDays: TripleSignalWindowDays
): TripleSignalPayload | null {
  let entry = memory.get(windowDays);
  if (!entry) {
    const disk = loadTripleSignalFromDisk(windowDays);
    if (disk) {
      hydrateMemory(windowDays, disk);
      entry = memory.get(windowDays);
    }
  }
  if (!entry) return null;
  if (Date.now() - entry.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadTripleSignalFromDisk(windowDays);
    if (disk) {
      hydrateMemory(windowDays, disk);
      return memory.get(windowDays)?.payload ?? null;
    }
    return null;
  }
  return entry.payload;
}

export async function getOrComputeTripleSignal(
  windowDays: TripleSignalWindowDays,
  compute: () => Promise<TripleSignalPayload>
): Promise<TripleSignalPayload> {
  const hit = getCachedTripleSignal(windowDays);
  if (hit) return hit;

  const existing = inflight.get(windowDays);
  if (existing) return existing;

  const promise = compute()
    .then((payload) => {
      if (payload.signals.length) {
        hydrateMemory(windowDays, payload);
        saveTripleSignalToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight.delete(windowDays);
    });

  inflight.set(windowDays, promise);
  return promise;
}

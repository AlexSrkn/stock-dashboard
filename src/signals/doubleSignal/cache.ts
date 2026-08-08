import fs from "node:fs";
import path from "node:path";
import type { DoubleSignalPayload, DoubleSignalWindowDays } from "./types.js";
import { DOUBLE_SIGNAL_WINDOW_OPTIONS } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload extends DoubleSignalPayload {
  version: 1;
  builtAt: string;
}

function cacheFileForWindow(windowDays: DoubleSignalWindowDays): string {
  return path.join(CACHE_DIR, `double-signal-${windowDays}d.json`);
}

const memory = new Map<
  DoubleSignalWindowDays,
  { loadedAt: number; payload: DoubleSignalPayload }
>();
const inflight = new Map<DoubleSignalWindowDays, Promise<DoubleSignalPayload>>();

function hydrateMemory(windowDays: DoubleSignalWindowDays, payload: DoubleSignalPayload): void {
  memory.set(windowDays, { loadedAt: Date.now(), payload });
}

export function loadDoubleSignalFromDisk(
  windowDays: DoubleSignalWindowDays
): DoubleSignalPayload | null {
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

export function saveDoubleSignalToDisk(payload: DoubleSignalPayload): void {
  if (!payload.signals.length) {
    console.warn(`Refusing to save empty double-signal cache (${payload.windowDays}d).`);
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

export function ensureDoubleSignalCacheOnStartup(): void {
  for (const windowDays of DOUBLE_SIGNAL_WINDOW_OPTIONS) {
    try {
      const file = cacheFileForWindow(windowDays);
      if (!fs.existsSync(file)) {
        console.log(`Double signal cache missing (${windowDays}d) — run: npm run signals:warm-double-signal`);
        continue;
      }
      const payload = loadDoubleSignalFromDisk(windowDays);
      if (!payload?.signals?.length) continue;
      hydrateMemory(windowDays, payload);
      console.log(
        `Double signal cache loaded (${windowDays}d, ${payload.signals.length} signals).`
      );
    } catch (err) {
      console.warn(
        `Double signal cache load failed (${windowDays}d):`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

export function getCachedDoubleSignal(
  windowDays: DoubleSignalWindowDays
): DoubleSignalPayload | null {
  let entry = memory.get(windowDays);
  if (!entry) {
    const disk = loadDoubleSignalFromDisk(windowDays);
    if (disk) {
      hydrateMemory(windowDays, disk);
      entry = memory.get(windowDays);
    }
  }
  if (!entry) return null;
  if (Date.now() - entry.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadDoubleSignalFromDisk(windowDays);
    if (disk) {
      hydrateMemory(windowDays, disk);
      return memory.get(windowDays)?.payload ?? null;
    }
    return null;
  }
  return entry.payload;
}

export async function getOrComputeDoubleSignal(
  windowDays: DoubleSignalWindowDays,
  compute: () => Promise<DoubleSignalPayload>
): Promise<DoubleSignalPayload> {
  const hit = getCachedDoubleSignal(windowDays);
  if (hit) return hit;

  const existing = inflight.get(windowDays);
  if (existing) return existing;

  const promise = compute()
    .then((payload) => {
      if (payload.signals.length) {
        hydrateMemory(windowDays, payload);
        saveDoubleSignalToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight.delete(windowDays);
    });

  inflight.set(windowDays, promise);
  return promise;
}

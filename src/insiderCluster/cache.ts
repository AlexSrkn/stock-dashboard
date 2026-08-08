import fs from "node:fs";
import path from "node:path";
import type { ClusterLookbackDays, InsiderClusterSignal } from "./types.js";
import { DEFAULT_CLUSTER_LOOKBACK_DAYS } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const cacheFileFor = (days: ClusterLookbackDays) =>
  path.join(CACHE_DIR, `insider-cluster-signals-${days}d.json`);

const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload {
  version: 1;
  lookbackDays: ClusterLookbackDays;
  builtAt: string;
  signals: InsiderClusterSignal[];
}

type MemoryEntry = {
  loadedAt: number;
  lookbackDays: ClusterLookbackDays;
  signals: InsiderClusterSignal[];
  byTicker: Map<string, InsiderClusterSignal>;
};

const memory = new Map<ClusterLookbackDays, MemoryEntry>();
const inflight = new Map<ClusterLookbackDays, Promise<InsiderClusterSignal[]>>();

function hydrateMemory(signals: InsiderClusterSignal[], lookbackDays: ClusterLookbackDays): void {
  memory.set(lookbackDays, {
    loadedAt: Date.now(),
    lookbackDays,
    signals,
    byTicker: new Map(signals.map((s) => [s.ticker, s])),
  });
}

export function loadInsiderClusterSignalsFromDisk(
  lookbackDays: ClusterLookbackDays = DEFAULT_CLUSTER_LOOKBACK_DAYS
): InsiderClusterSignal[] | null {
  try {
    const file = cacheFileFor(lookbackDays);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.signals) || !raw.signals.length) return null;
    return raw.signals;
  } catch {
    return null;
  }
}

export function saveInsiderClusterSignalsToDisk(
  signals: InsiderClusterSignal[],
  lookbackDays: ClusterLookbackDays = DEFAULT_CLUSTER_LOOKBACK_DAYS
): void {
  if (!signals.length) {
    console.warn(`Refusing to save empty insider cluster cache (${lookbackDays}d).`);
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const payload: DiskPayload = {
    version: 1,
    lookbackDays,
    builtAt: new Date().toISOString(),
    signals,
  };
  fs.writeFileSync(cacheFileFor(lookbackDays), JSON.stringify(payload), "utf8");
}

export function ensureInsiderClusterCacheOnStartup(): void {
  for (const days of [30, 60, 90] as ClusterLookbackDays[]) {
    try {
      const file = cacheFileFor(days);
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DiskPayload;
      if (!raw?.signals?.length) continue;
      hydrateMemory(raw.signals, days);
      console.log(`Insider cluster cache loaded (${days}d, ${raw.signals.length} tickers).`);
    } catch (err) {
      console.warn(
        `Insider cluster cache load failed (${days}d):`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  if (!memory.has(DEFAULT_CLUSTER_LOOKBACK_DAYS)) {
    console.log("Insider cluster cache missing — run: npm run insider-clusters:warm-cache");
  }
}

export function getCachedInsiderClusterSignals(
  lookbackDays: ClusterLookbackDays = DEFAULT_CLUSTER_LOOKBACK_DAYS
): InsiderClusterSignal[] | null {
  let entry = memory.get(lookbackDays);
  if (entry && !entry.signals.length) {
    memory.delete(lookbackDays);
    entry = undefined;
  }

  if (!entry) {
    const disk = loadInsiderClusterSignalsFromDisk(lookbackDays);
    if (disk?.length) hydrateMemory(disk, lookbackDays);
    entry = memory.get(lookbackDays);
  }

  if (!entry?.signals.length) return null;

  if (Date.now() - entry.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadInsiderClusterSignalsFromDisk(lookbackDays);
    if (disk?.length) {
      hydrateMemory(disk, lookbackDays);
      return memory.get(lookbackDays)!.signals;
    }
    return null;
  }

  return entry.signals;
}

export function getCachedInsiderClusterForTicker(
  ticker: string,
  lookbackDays: ClusterLookbackDays = DEFAULT_CLUSTER_LOOKBACK_DAYS
): InsiderClusterSignal | null {
  getCachedInsiderClusterSignals(lookbackDays);
  const entry = memory.get(lookbackDays);
  if (!entry) return null;
  return entry.byTicker.get(String(ticker).trim().toUpperCase()) ?? null;
}

export async function getOrComputeInsiderClusterSignals(
  lookbackDays: ClusterLookbackDays,
  compute: () => Promise<InsiderClusterSignal[]>
): Promise<InsiderClusterSignal[]> {
  const hit = getCachedInsiderClusterSignals(lookbackDays);
  if (hit?.length) return hit;

  const pending = inflight.get(lookbackDays);
  if (pending) return pending;

  const promise = compute()
    .then((signals) => {
      if (signals.length) {
        hydrateMemory(signals, lookbackDays);
        saveInsiderClusterSignalsToDisk(signals, lookbackDays);
      }
      return signals;
    })
    .finally(() => {
      inflight.delete(lookbackDays);
    });

  inflight.set(lookbackDays, promise);
  return promise;
}

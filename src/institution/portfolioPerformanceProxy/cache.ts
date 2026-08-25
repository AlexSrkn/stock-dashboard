import fs from "node:fs";
import path from "node:path";
import type { RawPortfolioSnapshot } from "./compute.js";
import { sortQuarters } from "../performance/quarters.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "portfolio-proxy-snapshots.json");
/** In-process TTL after a fresh compute; disk cache is used across restarts. */
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload {
  version: 1;
  builtAt: string;
  snapshots: RawPortfolioSnapshot[];
}

export interface SnapshotCache {
  loadedAt: number;
  snapshots: RawPortfolioSnapshot[];
  availableQuarters: string[];
}

let cache: SnapshotCache | null = null;

function hydrateMemory(snapshots: RawPortfolioSnapshot[], loadedAt: number): SnapshotCache {
  const availableQuarters = sortQuarters(snapshots.map((s) => s.quarter));
  const payload: SnapshotCache = { loadedAt, snapshots, availableQuarters };
  cache = payload;
  return payload;
}

export function loadPortfolioProxySnapshotsFromDisk(): RawPortfolioSnapshot[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.snapshots) || !raw.snapshots.length) {
      return null;
    }
    return raw.snapshots;
  } catch {
    return null;
  }
}

export function savePortfolioProxySnapshotsToDisk(snapshots: RawPortfolioSnapshot[]): void {
  if (!snapshots.length) {
    console.warn("Refusing to save empty portfolio proxy cache (existing file preserved).");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const payload: DiskPayload = {
    version: 1,
    builtAt: new Date().toISOString(),
    snapshots,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

/** Synchronous startup load — no DB work on npm start. */
export function ensurePortfolioProxyCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("Portfolio proxy cache missing — run: npm run institutions:warm-portfolio-proxy");
      return;
    }
    const snapshots = loadPortfolioProxySnapshotsFromDisk();
    if (!snapshots?.length) {
      console.log("Portfolio proxy cache empty — run: npm run institutions:warm-portfolio-proxy");
      return;
    }
    hydrateMemory(snapshots, Date.now());
    const instCount = new Set(snapshots.map((s) => s.institutionId)).size;
    console.log(`Portfolio proxy cache loaded (${instCount} institutions, ${snapshots.length} snapshots).`);
  } catch (err) {
    console.warn(
      "Portfolio proxy cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedPortfolioProxySnapshots(): SnapshotCache | null {
  if (cache && Date.now() - cache.loadedAt <= MEMORY_CACHE_MS) {
    return cache;
  }
  const disk = loadPortfolioProxySnapshotsFromDisk();
  if (!disk?.length) return null;
  return hydrateMemory(disk, Date.now());
}

export function setCachedPortfolioProxySnapshots(snapshots: RawPortfolioSnapshot[]): SnapshotCache {
  return hydrateMemory(snapshots, Date.now());
}

export function clearPortfolioProxyDiskCache(): void {
  cache = null;
}

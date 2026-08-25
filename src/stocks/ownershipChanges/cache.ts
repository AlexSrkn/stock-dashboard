import fs from "node:fs";
import path from "node:path";
import { filterFullyScrapedOwnershipQuarters } from "./compute.js";
import type { OwnershipChangesCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "ownership-changes.json");

interface DiskPayload extends OwnershipChangesCachePayload {
  version: 1;
}

let memoryCache: { loadedAt: number; payload: OwnershipChangesCachePayload } | null = null;
const MEMORY_CACHE_MS = 15 * 60 * 1000;

function sanitizeLoadedPayload(raw: OwnershipChangesCachePayload): OwnershipChangesCachePayload {
  const cleanedByQuarter: Record<string, OwnershipChangesCachePayload["byQuarter"][string]> = {};
  for (const [quarter, rows] of Object.entries(raw.byQuarter || {})) {
    if (!Array.isArray(rows)) continue;
    // Drop legacy share-delta rows (null ownership %) and absurd pp moves from bad SO math.
    const cleaned = rows.filter(
      (r) =>
        r.currentOwnershipPct != null &&
        r.previousOwnershipPct != null &&
        Number.isFinite(r.currentOwnershipPct) &&
        Number.isFinite(r.previousOwnershipPct) &&
        Number.isFinite(r.changePct) &&
        Math.abs(r.changePct) <= 250
    );
    if (cleaned.length) cleanedByQuarter[quarter] = cleaned;
  }

  const filtered = filterFullyScrapedOwnershipQuarters({
    ...raw,
    byQuarter: cleanedByQuarter,
  });
  const sectors = [
    ...new Set(
      Object.values(filtered.byQuarter)
        .flat()
        .map((r) => r.sector)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ].sort((a, b) => a.localeCompare(b));
  const exchanges = [
    ...new Set(
      Object.values(filtered.byQuarter)
        .flat()
        .map((r) => r.exchange)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    computedAt: raw.computedAt,
    quarters: filtered.quarters,
    defaultQuarter: filtered.defaultQuarter,
    sectors,
    exchanges,
    byQuarter: filtered.byQuarter,
  };
}

export function loadOwnershipChangesFromDisk(): OwnershipChangesCachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !raw.byQuarter) return null;
    const quarters = Array.isArray(raw.quarters) ? raw.quarters : [];
    const defaultQuarter =
      typeof raw.defaultQuarter === "string" && quarters.includes(raw.defaultQuarter)
        ? raw.defaultQuarter
        : null;
    return sanitizeLoadedPayload({
      computedAt: raw.computedAt,
      quarters,
      defaultQuarter,
      sectors: Array.isArray(raw.sectors) ? raw.sectors : [],
      exchanges: Array.isArray(raw.exchanges) ? raw.exchanges : [],
      byQuarter: raw.byQuarter,
    });
  } catch {
    return null;
  }
}

export function saveOwnershipChangesToDisk(payload: OwnershipChangesCachePayload): void {
  const rowCount = Object.values(payload.byQuarter).reduce((sum, rows) => sum + rows.length, 0);
  if (!rowCount) {
    console.warn("Refusing to save empty ownership-changes cache.");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const disk: DiskPayload = { version: 1, ...payload };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(disk), "utf8");
}

export function ensureOwnershipChangesCacheOnStartup(): void {
  const payload = loadOwnershipChangesFromDisk();
  if (!payload) {
    console.log("Ownership changes cache missing — run: npm run stocks:warm-ownership-changes");
    return;
  }
  memoryCache = { loadedAt: Date.now(), payload };
  const latest = payload.quarters[0];
  const count = latest ? (payload.byQuarter[latest]?.length ?? 0) : 0;
  const def = payload.defaultQuarter ?? latest ?? "—";
  console.log(
    `Ownership changes cache loaded (default ${def}, ${count} tickers in newest ${latest ?? "—"}).`
  );
}

export function getCachedOwnershipChanges(): OwnershipChangesCachePayload | null {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const disk = loadOwnershipChangesFromDisk();
  if (!disk) return null;
  memoryCache = { loadedAt: now, payload: disk };
  return disk;
}

export function setOwnershipChangesMemoryCache(payload: OwnershipChangesCachePayload): void {
  memoryCache = { loadedAt: Date.now(), payload };
}

let inflight: Promise<OwnershipChangesCachePayload> | null = null;

export async function getOrComputeOwnershipChanges(
  compute: () => Promise<OwnershipChangesCachePayload>
): Promise<OwnershipChangesCachePayload> {
  const hit = getCachedOwnershipChanges();
  if (hit) return hit;
  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      const rowCount = Object.values(payload.byQuarter).reduce((s, r) => s + r.length, 0);
      if (rowCount > 0) {
        setOwnershipChangesMemoryCache(payload);
        saveOwnershipChangesToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

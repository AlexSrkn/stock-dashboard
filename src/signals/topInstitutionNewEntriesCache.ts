import fs from "node:fs";
import path from "node:path";
import type { TopInstitutionNewEntriesPayload } from "./topInstitutionNewEntries.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "top-institution-new-entries.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload extends TopInstitutionNewEntriesPayload {
  version: 1;
  builtAt: string;
}

let cache: { loadedAt: number; payload: TopInstitutionNewEntriesPayload } | null = null;
let inflight: Promise<TopInstitutionNewEntriesPayload> | null = null;

function hydrateMemory(payload: TopInstitutionNewEntriesPayload, loadedAt: number): void {
  cache = { loadedAt, payload };
}

export function loadTopInstitutionNewEntriesFromDisk(): TopInstitutionNewEntriesPayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) return null;
    const { version: _v, builtAt: _b, ...payload } = raw;
    return payload;
  } catch {
    return null;
  }
}

export function saveTopInstitutionNewEntriesToDisk(payload: TopInstitutionNewEntriesPayload): void {
  if (!payload.entries.length && !payload.institutions.length) {
    console.warn("Refusing to save empty top-institution-new-entries cache.");
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

export function ensureTopInstitutionNewEntriesCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("Top institution new entries cache missing — run: npm run signals:warm-top-entries");
      return;
    }
    const payload = loadTopInstitutionNewEntriesFromDisk();
    if (!payload?.institutions?.length) return;
    hydrateMemory(payload, Date.now());
    console.log(
      `Top institution new entries cache loaded (${payload.institutions.length} funds, ${payload.entries.length} entries).`
    );
  } catch (err) {
    console.warn(
      "Top institution new entries cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedTopInstitutionNewEntries(): TopInstitutionNewEntriesPayload | null {
  if (!cache) {
    const disk = loadTopInstitutionNewEntriesFromDisk();
    if (disk) hydrateMemory(disk, Date.now());
  }
  if (!cache) return null;
  if (Date.now() - cache.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadTopInstitutionNewEntriesFromDisk();
    if (disk) {
      hydrateMemory(disk, Date.now());
      return cache.payload;
    }
    return null;
  }
  return cache.payload;
}

export async function getOrComputeTopInstitutionNewEntries(
  compute: () => Promise<TopInstitutionNewEntriesPayload>
): Promise<TopInstitutionNewEntriesPayload> {
  const hit = getCachedTopInstitutionNewEntries();
  if (hit) return hit;
  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      if (payload.institutions.length) {
        hydrateMemory(payload, Date.now());
        saveTopInstitutionNewEntriesToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

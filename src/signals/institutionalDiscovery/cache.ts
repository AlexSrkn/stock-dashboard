import fs from "node:fs";
import path from "node:path";
import type { InstitutionalDiscoveryCachePayload } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "institutional-discovery.json");
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload extends InstitutionalDiscoveryCachePayload {
  builtAt: string;
}

let memory: { loadedAt: number; payload: InstitutionalDiscoveryCachePayload } | null = null;
let inflight: Promise<InstitutionalDiscoveryCachePayload> | null = null;

function hydrateMemory(payload: InstitutionalDiscoveryCachePayload): void {
  memory = { loadedAt: Date.now(), payload };
}

export function loadInstitutionalDiscoveryFromDisk(): InstitutionalDiscoveryCachePayload | null {
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

export function saveInstitutionalDiscoveryToDisk(payload: InstitutionalDiscoveryCachePayload): void {
  const scored = payload.signals.filter((s) => !s.insufficientData && s.discoveryScore != null);
  if (!scored.length) {
    console.warn("Refusing to save empty institutional-discovery cache.");
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

export function ensureInstitutionalDiscoveryCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log(
        "Institutional discovery cache missing — run: npm run signals:warm-institutional-discovery"
      );
      return;
    }
    // Do not hydrate the full JSON into memory at boot — the file can be huge
    // and would pin hundreds of MB for every server process.
    const mb = fs.statSync(CACHE_FILE).size / (1024 * 1024);
    console.log(
      `Institutional discovery cache on disk (${mb.toFixed(1)} MB) — lazy-loaded on first request.`
    );
  } catch (err) {
    console.warn(
      "Institutional discovery cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getCachedInstitutionalDiscovery(): InstitutionalDiscoveryCachePayload | null {
  if (!memory) {
    const disk = loadInstitutionalDiscoveryFromDisk();
    if (disk) hydrateMemory(disk);
  }
  if (!memory) return null;
  if (Date.now() - memory.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadInstitutionalDiscoveryFromDisk();
    if (disk) {
      hydrateMemory(disk);
      return memory.payload;
    }
    return null;
  }
  return memory.payload;
}

export async function getOrComputeInstitutionalDiscovery(
  compute: () => Promise<InstitutionalDiscoveryCachePayload>
): Promise<InstitutionalDiscoveryCachePayload> {
  const hit = getCachedInstitutionalDiscovery();
  if (hit) return hit;

  if (inflight) return inflight;

  inflight = compute()
    .then((payload) => {
      const scored = payload.signals.filter((s) => !s.insufficientData && s.discoveryScore != null);
      if (scored.length) {
        hydrateMemory(payload);
        saveInstitutionalDiscoveryToDisk(payload);
      }
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

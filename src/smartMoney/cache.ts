import fs from "node:fs";
import path from "node:path";
import type { SmartMoneyScore } from "./types.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "smart-money-scores.json");
/** In-process TTL after a fresh compute; disk cache is used across restarts. */
const MEMORY_CACHE_MS = 60 * 60 * 1000;

interface DiskPayload {
  version: 1;
  builtAt: string;
  scores: SmartMoneyScore[];
}

let cache: { loadedAt: number; scores: SmartMoneyScore[]; byTicker: Map<string, SmartMoneyScore> } | null =
  null;
let inflight: Promise<SmartMoneyScore[]> | null = null;

function hydrateMemory(scores: SmartMoneyScore[], loadedAt: number): void {
  cache = {
    loadedAt,
    scores,
    byTicker: new Map(scores.map((s) => [s.ticker, s])),
  };
}

export function loadSmartMoneyScoresFromDisk(): SmartMoneyScore[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.scores) || !raw.scores.length) return null;
    return raw.scores;
  } catch {
    return null;
  }
}

export function saveSmartMoneyScoresToDisk(scores: SmartMoneyScore[]): void {
  if (!scores.length) {
    console.warn("Refusing to save empty smart money cache (existing file preserved).");
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const payload: DiskPayload = {
    version: 1,
    builtAt: new Date().toISOString(),
    scores,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
}

/** Synchronous startup load — no DB work on npm start. */
export function ensureSmartMoneyCacheOnStartup(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("Smart money cache missing — run: npm run smart-money:warm-cache");
      return;
    }
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskPayload;
    if (!raw?.scores?.length) {
      console.log("Smart money cache empty — run: npm run smart-money:warm-cache");
      return;
    }
    const loadedAt = Date.now();
    hydrateMemory(raw.scores, loadedAt);
    console.log(`Smart money cache loaded (${raw.scores.length} tickers).`);
  } catch (err) {
    console.warn(
      "Smart money cache load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function clearSmartMoneyCache(): void {
  cache = null;
  inflight = null;
}

export function getCachedSmartMoneyScores(): SmartMoneyScore[] | null {
  if (cache && !cache.scores.length) cache = null;

  if (!cache) {
    const disk = loadSmartMoneyScoresFromDisk();
    if (disk?.length) hydrateMemory(disk, Date.now());
  }
  if (!cache?.scores.length) return null;
  if (Date.now() - cache.loadedAt > MEMORY_CACHE_MS) {
    const disk = loadSmartMoneyScoresFromDisk();
    if (disk?.length) {
      hydrateMemory(disk, Date.now());
      return cache.scores;
    }
    return null;
  }
  return cache.scores;
}

export function getCachedSmartMoneyScore(ticker: string): SmartMoneyScore | null {
  getCachedSmartMoneyScores();
  if (!cache) return null;
  return cache.byTicker.get(String(ticker).trim().toUpperCase()) ?? null;
}

export async function getOrComputeSmartMoneyScores(
  compute: () => Promise<SmartMoneyScore[]>
): Promise<SmartMoneyScore[]> {
  const hit = getCachedSmartMoneyScores();
  if (hit?.length) return hit;
  if (inflight) return inflight;

  inflight = compute()
    .then((scores) => {
      if (scores.length) {
        hydrateMemory(scores, Date.now());
        saveSmartMoneyScoresToDisk(scores);
      }
      return scores;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

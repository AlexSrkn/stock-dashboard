import {
  SEC_DATA_BASE,
  formatSecCik,
  secFetchJson,
  type SecFetchOptions,
} from "../http.js";
import type { SecCompanyFacts } from "./types.js";

const CACHE_MS = 60 * 60 * 1000;
/** Company Facts JSON can be several MB each — cap entries to avoid OOM on bulk ingest. */
const MAX_CACHE_ENTRIES = 24;
const cache = new Map<string, { loadedAt: number; data: SecCompanyFacts }>();

function cacheGet(key: string, now: number): SecCompanyFacts | null {
  const hit = cache.get(key);
  if (!hit || now - hit.loadedAt >= CACHE_MS) return null;
  // Refresh LRU order.
  cache.delete(key);
  cache.set(key, hit);
  return hit.data;
}

function cacheSet(key: string, data: SecCompanyFacts, now: number): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { loadedAt: now, data });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
    else break;
  }
}

export function companyFactsUrl(cik: number | string): string {
  return `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${formatSecCik(cik)}.json`;
}

export async function fetchCompanyFacts(
  cik: number | string,
  options: SecFetchOptions = {}
): Promise<SecCompanyFacts> {
  const key = formatSecCik(cik);
  const now = Date.now();
  const cached = cacheGet(key, now);
  if (cached) return cached;

  const data = await secFetchJson<SecCompanyFacts>(companyFactsUrl(cik), options);
  if (!data?.facts) {
    throw new Error(`SEC Company Facts missing facts for CIK ${key}`);
  }
  cacheSet(key, data, now);
  return data;
}

export function clearCompanyFactsCache(): void {
  cache.clear();
}

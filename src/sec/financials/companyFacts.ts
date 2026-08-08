import {
  SEC_DATA_BASE,
  formatSecCik,
  secFetchJson,
  type SecFetchOptions,
} from "../http.js";
import type { SecCompanyFacts } from "./types.js";

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { loadedAt: number; data: SecCompanyFacts }>();

export function companyFactsUrl(cik: number | string): string {
  return `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${formatSecCik(cik)}.json`;
}

export async function fetchCompanyFacts(
  cik: number | string,
  options: SecFetchOptions = {}
): Promise<SecCompanyFacts> {
  const key = formatSecCik(cik);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.loadedAt < CACHE_MS) return hit.data;

  const data = await secFetchJson<SecCompanyFacts>(companyFactsUrl(cik), options);
  if (!data?.facts) {
    throw new Error(`SEC Company Facts missing facts for CIK ${key}`);
  }
  cache.set(key, { loadedAt: now, data });
  return data;
}

export function clearCompanyFactsCache(): void {
  cache.clear();
}

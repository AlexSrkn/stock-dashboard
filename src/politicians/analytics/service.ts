import {
  computePoliticianLargestPortfolios,
  computePoliticianMostAccumulated,
  parsePoliticianAnalyticsPeriod,
  parsePoliticianChamberFilter,
} from "./compute.js";
import {
  computePoliticianProfileSectorExposure,
  computePoliticianSectorDetail,
  computePoliticianSectorExposure,
  parseSectorExposureFilters,
  sectorFromSlug,
} from "./sectorExposure.js";
import type { PoliticianAnalyticsPeriod, PoliticianChamberFilter } from "./types.js";

export type {
  PoliticianLargestPortfoliosPayload,
  PoliticianMostAccumulatedPayload,
  PoliticianPortfolioRow,
} from "./types.js";
export { parsePoliticianAnalyticsPeriod, parsePoliticianChamberFilter } from "./compute.js";

let memoryCache: {
  loadedAt: number;
  mostAccumulated: Map<string, ReturnType<typeof computePoliticianMostAccumulated>>;
  largestPortfolios: Map<string, ReturnType<typeof computePoliticianLargestPortfolios>>;
  sectorExposure: Map<string, Awaited<ReturnType<typeof computePoliticianSectorExposure>>>;
  sectorDetail: Map<string, Awaited<ReturnType<typeof computePoliticianSectorDetail>>>;
  profileSector: Map<string, Awaited<ReturnType<typeof computePoliticianProfileSectorExposure>>>;
} | null = null;

const MEMORY_CACHE_MS = 5 * 60 * 1000;

function cacheKey(period: PoliticianAnalyticsPeriod, chamber: PoliticianChamberFilter): string {
  return `${period}:${chamber}`;
}

function ensureCache() {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) return memoryCache;
  memoryCache = {
    loadedAt: now,
    mostAccumulated: new Map(),
    largestPortfolios: new Map(),
    sectorExposure: new Map(),
    sectorDetail: new Map(),
    profileSector: new Map(),
  };
  return memoryCache;
}

export function getPoliticianMostAccumulated(
  period: PoliticianAnalyticsPeriod,
  chamber: PoliticianChamberFilter
) {
  const cache = ensureCache();
  const key = cacheKey(period, chamber);
  const hit = cache.mostAccumulated.get(key);
  if (hit) return hit;
  const payload = computePoliticianMostAccumulated(period, chamber);
  cache.mostAccumulated.set(key, payload);
  return payload;
}

export function getPoliticianLargestPortfolios(
  period: PoliticianAnalyticsPeriod,
  chamber: PoliticianChamberFilter
) {
  const cache = ensureCache();
  const key = cacheKey(period, chamber);
  const hit = cache.largestPortfolios.get(key);
  if (hit) return hit;
  const payload = computePoliticianLargestPortfolios(period, chamber);
  cache.largestPortfolios.set(key, payload);
  return payload;
}

function filtersCacheKey(filters: unknown): string {
  return JSON.stringify(filters);
}

export async function getPoliticianSectorExposure(url: URL) {
  const filters = parseSectorExposureFilters(url);
  const cache = ensureCache();
  const key = filtersCacheKey(filters);
  const hit = cache.sectorExposure.get(key);
  if (hit) return hit;
  const payload = await computePoliticianSectorExposure(filters);
  cache.sectorExposure.set(key, payload);
  return payload;
}

export async function getPoliticianSectorDetail(url: URL, sectorSlugParam: string) {
  const filters = parseSectorExposureFilters(url);
  const cache = ensureCache();
  const basePayload = await getPoliticianSectorExposure(url);
  const sectorName =
    sectorFromSlug(sectorSlugParam, basePayload.sectors) ||
    decodeURIComponent(sectorSlugParam).replace(/-/g, " ");
  const key = `${sectorSlugParam}:${filtersCacheKey(filters)}`;
  const hit = cache.sectorDetail.get(key);
  if (hit) return hit;
  const payload = await computePoliticianSectorDetail(sectorName, filters);
  cache.sectorDetail.set(key, payload);
  return payload;
}

export async function getPoliticianProfileSectorExposure(
  politicianKey: string,
  period: PoliticianAnalyticsPeriod,
  chamber: PoliticianChamberFilter
) {
  const cache = ensureCache();
  const key = `${politicianKey}:${period}:${chamber}`;
  const hit = cache.profileSector.get(key);
  if (hit) return hit;
  const payload = await computePoliticianProfileSectorExposure(politicianKey, period, chamber);
  cache.profileSector.set(key, payload);
  return payload;
}

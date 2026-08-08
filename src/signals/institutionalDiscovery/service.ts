import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getCachedInstitutionalDiscovery,
  getOrComputeInstitutionalDiscovery,
} from "./cache.js";
import { computeInstitutionalDiscovery } from "./compute.js";
import type {
  InstitutionalDiscoveryCachePayload,
  InstitutionalDiscoveryPayload,
  InstitutionalDiscoveryRow,
  MarketCapBucket,
} from "./types.js";

function parsePage(raw: string | null, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function parsePageSize(raw: string | null, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(10, Math.floor(n)));
}

export function parseMarketCapBucket(raw: string | null): MarketCapBucket {
  if (raw === "mega" || raw === "large" || raw === "mid" || raw === "small") return raw;
  return "";
}

function matchesMarketCap(marketCapUsd: number | null, bucket: MarketCapBucket): boolean {
  if (!bucket) return true;
  const v = Number(marketCapUsd);
  if (!Number.isFinite(v) || v <= 0) return false;
  if (bucket === "mega") return v >= 200e9;
  if (bucket === "large") return v >= 10e9 && v < 200e9;
  if (bucket === "mid") return v >= 2e9 && v < 10e9;
  if (bucket === "small") return v < 2e9;
  return true;
}

function parseOptionalNumber(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function filterDiscoveryRows(
  rows: InstitutionalDiscoveryRow[],
  options: {
    quarter?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    minScore?: number;
    minNewHolders?: number;
    minHolderGrowth?: number | null;
    minGrowthStreak?: number;
    includeInsufficient?: boolean;
    search?: string;
  }
): InstitutionalDiscoveryRow[] {
  const q = String(options.search || "")
    .trim()
    .toLowerCase();
  const minScore = Number(options.minScore) || 0;
  const minNew = Number(options.minNewHolders) || 0;
  const minStreak = Number(options.minGrowthStreak) || 0;

  return rows.filter((row) => {
    if (!options.includeInsufficient && row.insufficientData) return false;
    if (options.quarter && row.quarter !== options.quarter) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (minScore > 0 && (row.discoveryScore == null || row.discoveryScore < minScore)) return false;
    if (row.newHolderCount < minNew) return false;
    if (
      options.minHolderGrowth != null &&
      (row.holderGrowthPercent == null || row.holderGrowthPercent < options.minHolderGrowth)
    ) {
      return false;
    }
    if (row.currentGrowthStreak < minStreak) return false;
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

export function sortDiscoveryRows(
  rows: InstitutionalDiscoveryRow[],
  sortKey: string,
  sortDir: "asc" | "desc"
): InstitutionalDiscoveryRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  const key =
    sortKey === "holderGrowth"
      ? "holderGrowthPercent"
      : sortKey === "newHolders"
        ? "newHolderCount"
        : sortKey === "firstRecordedPositions"
          ? "firstTimePositionCount"
          : sortKey === "growthStreak"
            ? "currentGrowthStreak"
            : sortKey === "ownershipGrowth"
              ? "ownershipChangePercent"
              : sortKey === "latestQuarter"
                ? "quarter"
                : sortKey;

  return [...rows].sort((a, b) => {
    if (
      key === "ticker" ||
      key === "companyName" ||
      key === "sector" ||
      key === "classification" ||
      key === "quarter"
    ) {
      const av = String(
        key === "companyName"
          ? a.companyName || a.ticker
          : (a[key as keyof InstitutionalDiscoveryRow] as string) || ""
      ).toLowerCase();
      const bv = String(
        key === "companyName"
          ? b.companyName || b.ticker
          : (b[key as keyof InstitutionalDiscoveryRow] as string) || ""
      ).toLowerCase();
      return av.localeCompare(bv) * dir || a.ticker.localeCompare(b.ticker);
    }
    const ax = Number(a[key as keyof InstitutionalDiscoveryRow]);
    const bx = Number(b[key as keyof InstitutionalDiscoveryRow]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

function summarize(
  rows: InstitutionalDiscoveryRow[],
  cache: InstitutionalDiscoveryCachePayload
): InstitutionalDiscoveryPayload["summary"] {
  let fastest: InstitutionalDiscoveryPayload["summary"]["fastestHolderGrowth"] = null;
  let longest: InstitutionalDiscoveryPayload["summary"]["longestAdoptionStreak"] = null;
  let newPositions = 0;
  let discoveries = 0;

  for (const row of rows) {
    if (row.insufficientData || row.discoveryScore == null) continue;
    newPositions += row.newHolderCount;
    if (row.discoveryScore >= 60) discoveries += 1;
    if (
      row.holderGrowthPercent != null &&
      (!fastest || row.holderGrowthPercent > fastest.holderGrowthPercent)
    ) {
      fastest = {
        ticker: row.ticker,
        companyName: row.companyName,
        holderGrowthPercent: row.holderGrowthPercent,
      };
    }
    if (!longest || row.currentGrowthStreak > longest.streak) {
      longest = {
        ticker: row.ticker,
        companyName: row.companyName,
        streak: row.currentGrowthStreak,
      };
    }
  }

  return {
    newDiscoveries: discoveries,
    newInstitutionalPositions: newPositions,
    fastestHolderGrowth: fastest,
    longestAdoptionStreak: longest,
    currentQuarter: cache.currentQuarter,
    previousQuarter: cache.previousQuarter,
  };
}

export async function loadInstitutionalDiscoveryCache(
  pool: pg.Pool = getPool()
): Promise<InstitutionalDiscoveryCachePayload> {
  return getOrComputeInstitutionalDiscovery(() => computeInstitutionalDiscovery(pool));
}

export async function getInstitutionalDiscovery(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<InstitutionalDiscoveryPayload> {
  const cache = await loadInstitutionalDiscoveryCache(pool);
  const quarter =
    String(url.searchParams.get("quarter") || "").trim() || cache.currentQuarter || "";
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const minNewHolders = Math.max(0, Number(url.searchParams.get("minNewHolders") || 0) || 0);
  const minHolderGrowth = parseOptionalNumber(url.searchParams.get("minHolderGrowth"));
  const minGrowthStreak = Math.max(0, Number(url.searchParams.get("minGrowthStreak") || 0) || 0);
  const includeInsufficient =
    url.searchParams.get("includeInsufficient") === "1" ||
    url.searchParams.get("includeInsufficient") === "true";
  const search = String(url.searchParams.get("search") || "").trim();
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = url.searchParams.get("sort") || "discoveryScore";
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterDiscoveryRows(cache.signals, {
    quarter,
    sector,
    marketCap,
    minScore,
    minNewHolders,
    minHolderGrowth,
    minGrowthStreak,
    includeInsufficient,
    search,
  });
  const sorted = sortDiscoveryRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    currentQuarter: cache.currentQuarter,
    previousQuarter: cache.previousQuarter,
    quarters: cache.quarters,
    summary: summarize(sorted, cache),
    sectors: cache.sectors,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    signals: sorted.slice(offset, offset + pageSize),
  };
}

export { getCachedInstitutionalDiscovery };

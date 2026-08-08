import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getOrComputeHiddenGems, getCachedHiddenGems } from "./cache.js";
import { computeHiddenGems } from "./compute.js";
import type {
  HiddenGemRow,
  HiddenGemsCachePayload,
  HiddenGemsPayload,
  HiddenGemThresholds,
  MarketCapBucket,
} from "./types.js";
import { DEFAULT_HIDDEN_GEM_THRESHOLDS } from "./types.js";

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

export function filterHiddenGemRows(
  rows: HiddenGemRow[],
  options: {
    quarter?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    minScore?: number;
    maxOwnershipPct?: number | null;
    minOwnershipGrowth?: number | null;
    minInstitutions?: number;
    onlyNewPositions?: boolean;
    minMarketCapUsd?: number | null;
    search?: string;
  }
): HiddenGemRow[] {
  const q = String(options.search || "")
    .trim()
    .toLowerCase();
  const minScore = Number(options.minScore) || 0;
  const minInst = Number(options.minInstitutions) || 0;

  return rows.filter((row) => {
    if (options.quarter && row.quarter !== options.quarter) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (row.hiddenGemScore < minScore) return false;
    if (
      options.maxOwnershipPct != null &&
      row.institutionalOwnership > options.maxOwnershipPct
    ) {
      return false;
    }
    if (
      options.minOwnershipGrowth != null &&
      row.ownershipGrowth < options.minOwnershipGrowth
    ) {
      return false;
    }
    if (row.institutionsCount < minInst) return false;
    if (options.onlyNewPositions && row.newPositionsCount <= 0) return false;
    if (
      options.minMarketCapUsd != null &&
      (row.marketCapUsd == null || row.marketCapUsd < options.minMarketCapUsd)
    ) {
      return false;
    }
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

export function sortHiddenGemRows(
  rows: HiddenGemRow[],
  sortKey: string,
  sortDir: "asc" | "desc"
): HiddenGemRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (
      sortKey === "ticker" ||
      sortKey === "companyName" ||
      sortKey === "sector" ||
      sortKey === "label" ||
      sortKey === "quarter"
    ) {
      const av = String(
        sortKey === "companyName" ? a.companyName || a.ticker : a[sortKey as keyof HiddenGemRow] || ""
      ).toLowerCase();
      const bv = String(
        sortKey === "companyName" ? b.companyName || b.ticker : b[sortKey as keyof HiddenGemRow] || ""
      ).toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    const ax = Number(a[sortKey as keyof HiddenGemRow]);
    const bx = Number(b[sortKey as keyof HiddenGemRow]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

function summarize(rows: HiddenGemRow[], cache: HiddenGemsCachePayload) {
  return {
    totalGems: rows.length,
    emerging: rows.filter((s) => s.label === "Emerging").length,
    hiddenGem: rows.filter((s) => s.label === "Hidden Gem").length,
    strongAccumulation: rows.filter((s) => s.label === "Strong Accumulation").length,
    institutionalDiscovery: rows.filter((s) => s.label === "Institutional Discovery").length,
    currentQuarter: cache.currentQuarter,
    previousQuarter: cache.previousQuarter,
  };
}

export async function loadHiddenGemsCache(
  pool: pg.Pool = getPool()
): Promise<HiddenGemsCachePayload> {
  return getOrComputeHiddenGems(() => computeHiddenGems(pool));
}

export async function getHiddenGems(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<HiddenGemsPayload> {
  const cache = await loadHiddenGemsCache(pool);
  const quarter =
    String(url.searchParams.get("quarter") || "").trim() || cache.currentQuarter || "";
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const maxOwnershipPct = parseOptionalNumber(url.searchParams.get("maxOwnershipPct"));
  const minOwnershipGrowth = parseOptionalNumber(url.searchParams.get("minOwnershipGrowth"));
  const minInstitutions = Math.max(0, Number(url.searchParams.get("minInstitutions") || 0) || 0);
  const onlyNewPositions =
    url.searchParams.get("onlyNewPositions") === "1" ||
    url.searchParams.get("onlyNewPositions") === "true";
  const minMarketCapUsd = parseOptionalNumber(url.searchParams.get("minMarketCap"));
  const search = String(url.searchParams.get("search") || "").trim();
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = url.searchParams.get("sort") || "hiddenGemScore";
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterHiddenGemRows(cache.signals, {
    quarter,
    sector,
    marketCap,
    minScore,
    maxOwnershipPct,
    minOwnershipGrowth,
    minInstitutions,
    onlyNewPositions,
    minMarketCapUsd,
    search,
  });
  const sorted = sortHiddenGemRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    currentQuarter: cache.currentQuarter,
    previousQuarter: cache.previousQuarter,
    quarters: cache.quarters,
    thresholds: cache.thresholds ?? DEFAULT_HIDDEN_GEM_THRESHOLDS,
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

export type { HiddenGemThresholds };
export { getCachedHiddenGems, DEFAULT_HIDDEN_GEM_THRESHOLDS };


import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getOrComputeHeavySelling, getCachedHeavySelling } from "./cache.js";
import { computeHeavySelling } from "./compute.js";
import { DEFAULT_CLUSTER_WINDOW_DAYS, resolveHeavySellingRole } from "./config.js";
import { parseDateMs } from "./score.js";
import type {
  HeavySellingPayload,
  HeavySellingRow,
  HeavySellingSummary,
  HeavySellingSortKey,
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

function parseSortKey(raw: string | null): HeavySellingSortKey {
  const allowed: HeavySellingSortKey[] = [
    "heavySellingScore",
    "valueSold",
    "uniqueSellers",
    "executiveSellers",
    "largestSale",
    "latestSaleDate",
    "ticker",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as HeavySellingSortKey;
  return "heavySellingScore";
}

function roleMatches(row: HeavySellingRow, roleFilter: string): boolean {
  if (!roleFilter) return true;
  const want = roleFilter.trim().toLowerCase();
  if (!want) return true;
  if (want === "executive" || want === "executives") return row.executiveSellers > 0;
  const resolved = resolveHeavySellingRole(want);
  const counts = row.roleSaleCounts;
  for (const [role, count] of Object.entries(counts)) {
    if (count <= 0) continue;
    if (role.toLowerCase() === want) return true;
    if (resolved && role.toLowerCase() === resolved.toLowerCase()) return true;
  }
  return false;
}

export function filterHeavySellingRows(
  rows: HeavySellingRow[],
  options: {
    minScore?: number;
    minUniqueSellers?: number;
    minTransactionValue?: number | null;
    clusterOnly?: boolean;
    dateFrom?: string | null;
    dateTo?: string | null;
    role?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    ticker?: string;
    search?: string;
  }
): HeavySellingRow[] {
  const minScore = Number(options.minScore) || 0;
  const minUnique = Number(options.minUniqueSellers) || 0;
  const minValue = options.minTransactionValue;
  const fromMs = options.dateFrom ? parseDateMs(options.dateFrom) : Number.NaN;
  const toMs = options.dateTo ? parseDateMs(options.dateTo) : Number.NaN;
  const ticker = String(options.ticker || "")
    .trim()
    .toUpperCase();
  const q = String(options.search || "")
    .trim()
    .toLowerCase();

  return rows.filter((row) => {
    if (row.heavySellingScore < minScore) return false;
    if (row.uniqueSellers < minUnique) return false;
    if (minValue != null && row.largestSale < minValue) return false;
    if (options.clusterOnly && !row.clusterSelling) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (ticker && row.ticker !== ticker) return false;
    if (!roleMatches(row, options.role || "")) return false;

    const dateMs = parseDateMs(row.latestSaleDate);
    if (Number.isFinite(fromMs) && Number.isFinite(dateMs) && dateMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(dateMs) && dateMs > toMs + 86_400_000 - 1) {
      return false;
    }

    if (!q) return true;
    const hay = `${row.ticker} ${row.companyName || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortHeavySellingRows(
  rows: HeavySellingRow[],
  sortKey: HeavySellingSortKey,
  sortDir: "asc" | "desc"
): HeavySellingRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      return a.ticker.localeCompare(b.ticker) * dir || b.heavySellingScore - a.heavySellingScore;
    }
    if (sortKey === "latestSaleDate") {
      const av = parseDateMs(a.latestSaleDate) || 0;
      const bv = parseDateMs(b.latestSaleDate) || 0;
      return (av - bv) * dir || b.heavySellingScore - a.heavySellingScore;
    }
    const ax = Number(a[sortKey]);
    const bx = Number(b[sortKey]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export function summarizeHeavySelling(rows: HeavySellingRow[]): HeavySellingSummary {
  if (!rows.length) {
    return {
      largestInsiderSale: null,
      clusterSellingEvents: 0,
      executiveSellers: 0,
      totalInsiderSelling: 0,
    };
  }
  let largest = rows[0];
  let clusters = 0;
  let execTotal = 0;
  let totalSold = 0;
  for (const row of rows) {
    if (row.largestSale > largest.largestSale) largest = row;
    if (row.clusterSelling) clusters += 1;
    execTotal += row.executiveSellers;
    totalSold += row.valueSold;
  }
  return {
    largestInsiderSale: {
      ticker: largest.ticker,
      value: largest.largestSale,
      insiderName: largest.largestSaleInsider,
    },
    clusterSellingEvents: clusters,
    executiveSellers: execTotal,
    totalInsiderSelling: Math.round(totalSold * 100) / 100,
  };
}

export async function loadHeavySellingCache(
  pool: pg.Pool = getPool()
): Promise<import("./types.js").HeavySellingCachePayload> {
  return getOrComputeHeavySelling(() => computeHeavySelling(pool));
}

export async function getHeavySelling(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<HeavySellingPayload> {
  const dateFrom = url.searchParams.get("dateFrom") || url.searchParams.get("from");
  const dateTo = url.searchParams.get("dateTo") || url.searchParams.get("to");
  const clusterWindowRaw = parseOptionalNumber(url.searchParams.get("clusterWindowDays"));
  const clusterWindowDays =
    clusterWindowRaw != null && clusterWindowRaw > 0
      ? Math.min(365, Math.floor(clusterWindowRaw))
      : DEFAULT_CLUSTER_WINDOW_DAYS;
  const hasDateFilter = Boolean(dateFrom || dateTo);
  const customWindow = clusterWindowDays !== DEFAULT_CLUSTER_WINDOW_DAYS;

  const cache =
    hasDateFilter || customWindow
      ? await computeHeavySelling(pool, { dateFrom, dateTo, clusterWindowDays })
      : await loadHeavySellingCache(pool);

  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const minUniqueSellers = Math.max(
    0,
    Number(url.searchParams.get("minUniqueSellers") || 0) || 0
  );
  const minTransactionValue = parseOptionalNumber(url.searchParams.get("minTransactionValue"));
  const clusterOnly =
    url.searchParams.get("clusterOnly") === "1" ||
    url.searchParams.get("clusterOnly") === "true";
  const role = String(url.searchParams.get("role") || "").trim();
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const ticker = String(url.searchParams.get("ticker") || "").trim();
  const search = String(url.searchParams.get("search") || "").trim();
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = parseSortKey(url.searchParams.get("sort"));
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  // When dates already applied in compute, skip date filter on rows
  const filtered = filterHeavySellingRows(cache.rows, {
    minScore,
    minUniqueSellers,
    minTransactionValue,
    clusterOnly,
    dateFrom: hasDateFilter ? null : dateFrom,
    dateTo: hasDateFilter ? null : dateTo,
    role,
    sector,
    marketCap,
    ticker,
    search,
  });
  const sorted = sortHeavySellingRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    clusterWindowDays: cache.clusterWindowDays ?? clusterWindowDays,
    summary: summarizeHeavySelling(sorted),
    sectors: cache.sectors,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    rows: sorted.slice(offset, offset + pageSize),
  };
}

export { getCachedHeavySelling };

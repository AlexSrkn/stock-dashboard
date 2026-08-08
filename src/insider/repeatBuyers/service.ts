import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getOrComputeRepeatBuyers, getCachedRepeatBuyers } from "./cache.js";
import { computeRepeatBuyers } from "./compute.js";
import { parseDateMs } from "./score.js";
import { resolveConvictionRole } from "../convictionBuys/roleWeights.js";
import type {
  RepeatBuyerRow,
  RepeatBuyersPayload,
  RepeatBuyersSummary,
  RepeatBuyerSortKey,
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

function parseSortKey(raw: string | null): RepeatBuyerSortKey {
  const allowed: RepeatBuyerSortKey[] = [
    "repeatBuyerScore",
    "purchaseCount",
    "purchaseStreak",
    "totalInvested",
    "latestPurchase",
    "purchasesLast12Months",
    "ticker",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as RepeatBuyerSortKey;
  return "repeatBuyerScore";
}

function roleMatches(row: RepeatBuyerRow, roleFilter: string): boolean {
  if (!roleFilter) return true;
  const want = roleFilter.trim().toLowerCase();
  if (!want) return true;
  const resolved = resolveConvictionRole(row.title).toLowerCase();
  if (resolved === want) return true;
  if (want === "10% owner" || want === "10-owner" || want === "ten-percent-owner") {
    return resolved === "10% owner";
  }
  return row.role.toLowerCase() === want || String(row.title || "").toLowerCase().includes(want);
}

export function filterRepeatBuyerRows(
  rows: RepeatBuyerRow[],
  options: {
    minScore?: number;
    minPurchases?: number;
    minStreak?: number;
    minInvested?: number | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    role?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    ticker?: string;
    search?: string;
  }
): RepeatBuyerRow[] {
  const minScore = Number(options.minScore) || 0;
  const minPurchases = Number(options.minPurchases) || 0;
  const minStreak = Number(options.minStreak) || 0;
  const minInvested = options.minInvested;
  const fromMs = options.dateFrom ? parseDateMs(options.dateFrom) : Number.NaN;
  const toMs = options.dateTo ? parseDateMs(options.dateTo) : Number.NaN;
  const ticker = String(options.ticker || "")
    .trim()
    .toUpperCase();
  const q = String(options.search || "")
    .trim()
    .toLowerCase();

  return rows.filter((row) => {
    if (row.repeatBuyerScore < minScore) return false;
    if (row.purchaseCount < minPurchases) return false;
    if (row.purchaseStreak < minStreak) return false;
    if (minInvested != null && row.totalInvested < minInvested) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (ticker && row.ticker !== ticker) return false;
    if (!roleMatches(row, options.role || "")) return false;

    const latestMs = parseDateMs(row.latestPurchase);
    if (Number.isFinite(fromMs) && Number.isFinite(latestMs) && latestMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(latestMs) && latestMs > toMs + 86_400_000 - 1) {
      return false;
    }

    if (!q) return true;
    const hay = `${row.ticker} ${row.companyName || ""} ${row.insiderName}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortRepeatBuyerRows(
  rows: RepeatBuyerRow[],
  sortKey: RepeatBuyerSortKey,
  sortDir: "asc" | "desc"
): RepeatBuyerRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      return a.ticker.localeCompare(b.ticker) * dir || b.repeatBuyerScore - a.repeatBuyerScore;
    }
    if (sortKey === "latestPurchase") {
      const av = parseDateMs(a.latestPurchase) || 0;
      const bv = parseDateMs(b.latestPurchase) || 0;
      return (av - bv) * dir || b.repeatBuyerScore - a.repeatBuyerScore;
    }
    const ax = Number(a[sortKey]);
    const bx = Number(b[sortKey]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export function summarizeRepeatBuyers(rows: RepeatBuyerRow[]): RepeatBuyersSummary {
  if (!rows.length) {
    return {
      activeRepeatBuyers: 0,
      longestPurchaseStreak: 0,
      largestTotalInvestment: 0,
      averageRepeatBuyerScore: 0,
    };
  }
  let sumScore = 0;
  let longest = 0;
  let largest = 0;
  let active = 0;
  for (const row of rows) {
    sumScore += row.repeatBuyerScore;
    if (row.purchaseStreak > longest) longest = row.purchaseStreak;
    if (row.totalInvested > largest) largest = row.totalInvested;
    if (row.repeatBuyerScore >= 40) active += 1;
  }
  return {
    activeRepeatBuyers: active,
    longestPurchaseStreak: longest,
    largestTotalInvestment: Math.round(largest * 100) / 100,
    averageRepeatBuyerScore: Math.round((sumScore / rows.length) * 10) / 10,
  };
}

export async function loadRepeatBuyersCache(
  pool: pg.Pool = getPool()
): Promise<import("./types.js").RepeatBuyersCachePayload> {
  return getOrComputeRepeatBuyers(() => computeRepeatBuyers(pool));
}

export async function getRepeatBuyers(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<RepeatBuyersPayload> {
  const cache = await loadRepeatBuyersCache(pool);
  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const minPurchases = Math.max(0, Number(url.searchParams.get("minPurchases") || 0) || 0);
  const minStreak = Math.max(0, Number(url.searchParams.get("minStreak") || 0) || 0);
  const minInvested = parseOptionalNumber(url.searchParams.get("minInvested"));
  const dateFrom = url.searchParams.get("dateFrom") || url.searchParams.get("from");
  const dateTo = url.searchParams.get("dateTo") || url.searchParams.get("to");
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

  const filtered = filterRepeatBuyerRows(cache.rows, {
    minScore,
    minPurchases,
    minStreak,
    minInvested,
    dateFrom,
    dateTo,
    role,
    sector,
    marketCap,
    ticker,
    search,
  });
  const sorted = sortRepeatBuyerRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    summary: summarizeRepeatBuyers(sorted),
    sectors: cache.sectors,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    rows: sorted.slice(offset, offset + pageSize),
  };
}

export { getCachedRepeatBuyers };

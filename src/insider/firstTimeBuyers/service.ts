import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getOrComputeFirstTimeBuyers, getCachedFirstTimeBuyers } from "./cache.js";
import { computeFirstTimeBuyers } from "./compute.js";
import { DEFAULT_MIN_YEARS_SINCE_LAST_BUY } from "./config.js";
import { parseDateMs } from "./score.js";
import { resolveFirstTimeBuyerRole } from "./config.js";
import type {
  FirstTimeBuyerRow,
  FirstTimeBuyersPayload,
  FirstTimeBuyersSummary,
  FirstTimeBuyerSortKey,
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

function parseSortKey(raw: string | null): FirstTimeBuyerSortKey {
  const allowed: FirstTimeBuyerSortKey[] = [
    "firstTimeBuyerScore",
    "yearsSinceLastBuy",
    "purchaseValue",
    "filingDate",
    "transactionDate",
    "ticker",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as FirstTimeBuyerSortKey;
  return "firstTimeBuyerScore";
}

function roleMatches(row: FirstTimeBuyerRow, roleFilter: string): boolean {
  if (!roleFilter) return true;
  const want = roleFilter.trim().toLowerCase();
  if (!want) return true;
  const resolved = resolveFirstTimeBuyerRole(row.title).toLowerCase();
  if (resolved === want) return true;
  if (want === "10% owner" || want === "10-owner" || want === "ten-percent-owner") {
    return resolved === "10% owner";
  }
  return row.role.toLowerCase() === want || String(row.title || "").toLowerCase().includes(want);
}

export function filterFirstTimeBuyerRows(
  rows: FirstTimeBuyerRow[],
  options: {
    minScore?: number;
    minYears?: number;
    firstEverOnly?: boolean;
    dateFrom?: string | null;
    dateTo?: string | null;
    role?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    ticker?: string;
    search?: string;
  }
): FirstTimeBuyerRow[] {
  const minScore = Number(options.minScore) || 0;
  const minYears = Number(options.minYears) || 0;
  const fromMs = options.dateFrom ? parseDateMs(options.dateFrom) : Number.NaN;
  const toMs = options.dateTo ? parseDateMs(options.dateTo) : Number.NaN;
  const ticker = String(options.ticker || "")
    .trim()
    .toUpperCase();
  const q = String(options.search || "")
    .trim()
    .toLowerCase();

  return rows.filter((row) => {
    if (row.firstTimeBuyerScore < minScore) return false;
    if (options.firstEverOnly && !row.firstEverPurchase) return false;
    if (minYears > 0) {
      if (row.firstEverPurchase) {
        /* first-ever always satisfies gap filter */
      } else if (
        row.yearsSinceLastBuy == null ||
        row.yearsSinceLastBuy < minYears
      ) {
        return false;
      }
    }
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (ticker && row.ticker !== ticker) return false;
    if (!roleMatches(row, options.role || "")) return false;

    const dateMs = parseDateMs(row.transactionDate) || parseDateMs(row.filingDate);
    if (Number.isFinite(fromMs) && Number.isFinite(dateMs) && dateMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(dateMs) && dateMs > toMs + 86_400_000 - 1) {
      return false;
    }

    if (!q) return true;
    const hay = `${row.ticker} ${row.companyName || ""} ${row.insiderName}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortFirstTimeBuyerRows(
  rows: FirstTimeBuyerRow[],
  sortKey: FirstTimeBuyerSortKey,
  sortDir: "asc" | "desc"
): FirstTimeBuyerRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      return a.ticker.localeCompare(b.ticker) * dir || b.firstTimeBuyerScore - a.firstTimeBuyerScore;
    }
    if (sortKey === "filingDate" || sortKey === "transactionDate") {
      const av = parseDateMs(a[sortKey]) || 0;
      const bv = parseDateMs(b[sortKey]) || 0;
      return (av - bv) * dir || b.firstTimeBuyerScore - a.firstTimeBuyerScore;
    }
    if (sortKey === "yearsSinceLastBuy") {
      const av = a.firstEverPurchase
        ? Number.POSITIVE_INFINITY
        : Number(a.yearsSinceLastBuy);
      const bv = b.firstEverPurchase
        ? Number.POSITIVE_INFINITY
        : Number(b.yearsSinceLastBuy);
      const an = Number.isFinite(av) ? av : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      const bn = Number.isFinite(bv) ? bv : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      return (an - bn) * dir || b.firstTimeBuyerScore - a.firstTimeBuyerScore;
    }
    const ax = Number(a[sortKey]);
    const bx = Number(b[sortKey]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export function summarizeFirstTimeBuyers(rows: FirstTimeBuyerRow[]): FirstTimeBuyersSummary {
  if (!rows.length) {
    return {
      firstEverBuyers: 0,
      averageYearsSinceLastBuy: null,
      highestConviction: null,
      totalCapitalInvested: 0,
    };
  }
  let firstEver = 0;
  let yearSum = 0;
  let yearCount = 0;
  let capital = 0;
  let best = rows[0];
  for (const row of rows) {
    if (row.firstEverPurchase) firstEver += 1;
    else if (row.yearsSinceLastBuy != null && Number.isFinite(row.yearsSinceLastBuy)) {
      yearSum += row.yearsSinceLastBuy;
      yearCount += 1;
    }
    capital += row.purchaseValue;
    if (
      row.firstTimeBuyerScore > best.firstTimeBuyerScore ||
      (row.firstTimeBuyerScore === best.firstTimeBuyerScore &&
        row.purchaseValue > best.purchaseValue)
    ) {
      best = row;
    }
  }
  return {
    firstEverBuyers: firstEver,
    averageYearsSinceLastBuy:
      yearCount > 0 ? Math.round((yearSum / yearCount) * 10) / 10 : null,
    highestConviction: {
      ticker: best.ticker,
      insiderName: best.insiderName,
      score: best.firstTimeBuyerScore,
      purchaseValue: best.purchaseValue,
    },
    totalCapitalInvested: Math.round(capital * 100) / 100,
  };
}

export async function loadFirstTimeBuyersCache(
  pool: pg.Pool = getPool()
): Promise<import("./types.js").FirstTimeBuyersCachePayload> {
  return getOrComputeFirstTimeBuyers(() => computeFirstTimeBuyers(pool));
}

export async function getFirstTimeBuyers(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<FirstTimeBuyersPayload> {
  const cache = await loadFirstTimeBuyersCache(pool);
  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const minYearsRaw = parseOptionalNumber(url.searchParams.get("minYears"));
  const minYears =
    minYearsRaw != null
      ? Math.max(0, minYearsRaw)
      : cache.minYearsThreshold ?? DEFAULT_MIN_YEARS_SINCE_LAST_BUY;
  const firstEverOnly =
    url.searchParams.get("firstEverOnly") === "1" ||
    url.searchParams.get("firstEverOnly") === "true";
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

  const filtered = filterFirstTimeBuyerRows(cache.rows, {
    minScore,
    minYears,
    firstEverOnly,
    dateFrom,
    dateTo,
    role,
    sector,
    marketCap,
    ticker,
    search,
  });
  const sorted = sortFirstTimeBuyerRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    minYearsThreshold: cache.minYearsThreshold ?? DEFAULT_MIN_YEARS_SINCE_LAST_BUY,
    summary: summarizeFirstTimeBuyers(sorted),
    sectors: cache.sectors,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    rows: sorted.slice(offset, offset + pageSize),
  };
}

export { getCachedFirstTimeBuyers };

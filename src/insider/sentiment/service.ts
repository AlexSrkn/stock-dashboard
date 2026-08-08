import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getOrComputeInsiderSentiment,
  getCachedInsiderSentiment,
} from "./cache.js";
import { computeInsiderSentiment } from "./compute.js";
import { parseDateMs } from "./score.js";
import type {
  InsiderSentimentPayload,
  InsiderSentimentRow,
  InsiderSentimentSummary,
  MarketCapBucket,
  SentimentSortKey,
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

function parseSortKey(raw: string | null): SentimentSortKey {
  const allowed: SentimentSortKey[] = [
    "sentimentScore",
    "netDollarFlow",
    "buyValue",
    "sellValue",
    "buyerRatio",
    "ticker",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as SentimentSortKey;
  return "sentimentScore";
}

export function filterSentimentRows(
  rows: InsiderSentimentRow[],
  options: {
    minScore?: number | null;
    minTrades?: number;
    minUniqueInsiders?: number;
    sector?: string;
    marketCap?: MarketCapBucket;
    search?: string;
  }
): InsiderSentimentRow[] {
  const minScore = options.minScore;
  const minTrades = Number(options.minTrades) || 0;
  const minUnique = Number(options.minUniqueInsiders) || 0;
  const q = String(options.search || "")
    .trim()
    .toLowerCase();

  return rows.filter((row) => {
    if (minScore != null && Number.isFinite(minScore) && row.sentimentScore < minScore) {
      return false;
    }
    if (row.totalTrades < minTrades) return false;
    if (row.uniqueInsiders < minUnique) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (!q) return true;
    const hay = `${row.ticker} ${row.companyName || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortSentimentRows(
  rows: InsiderSentimentRow[],
  sortKey: SentimentSortKey,
  sortDir: "asc" | "desc"
): InsiderSentimentRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      return a.ticker.localeCompare(b.ticker) * dir || b.sentimentScore - a.sentimentScore;
    }
    const ax = Number(a[sortKey]);
    const bx = Number(b[sortKey]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export function summarizeSentiment(rows: InsiderSentimentRow[]): InsiderSentimentSummary {
  if (!rows.length) {
    return {
      mostBullishStocks: 0,
      mostBearishStocks: 0,
      netInsiderBuying: 0,
      averageSentimentScore: 0,
      topBullishTicker: null,
      topBearishTicker: null,
    };
  }
  let sumScore = 0;
  let netBuying = 0;
  let bullish = 0;
  let bearish = 0;
  let topBull = rows[0];
  let topBear = rows[0];
  for (const row of rows) {
    sumScore += row.sentimentScore;
    netBuying += row.netDollarFlow;
    if (row.sentimentScore >= 40) bullish += 1;
    if (row.sentimentScore <= -40) bearish += 1;
    if (row.sentimentScore > topBull.sentimentScore) topBull = row;
    if (row.sentimentScore < topBear.sentimentScore) topBear = row;
  }
  return {
    mostBullishStocks: bullish,
    mostBearishStocks: bearish,
    netInsiderBuying: Math.round(netBuying * 100) / 100,
    averageSentimentScore: Math.round((sumScore / rows.length) * 10) / 10,
    topBullishTicker: topBull.ticker,
    topBearishTicker: topBear.ticker,
  };
}

export async function loadInsiderSentimentCache(
  pool: pg.Pool = getPool()
): Promise<import("./types.js").InsiderSentimentCachePayload> {
  return getOrComputeInsiderSentiment(() => computeInsiderSentiment(pool));
}

export async function getInsiderSentiment(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<InsiderSentimentPayload> {
  const dateFrom = url.searchParams.get("dateFrom") || url.searchParams.get("from");
  const dateTo = url.searchParams.get("dateTo") || url.searchParams.get("to");
  const hasDateFilter = Boolean(dateFrom || dateTo);

  const cache = hasDateFilter
    ? await computeInsiderSentiment(pool, { dateFrom, dateTo })
    : await loadInsiderSentimentCache(pool);

  const minScore = parseOptionalNumber(url.searchParams.get("minScore"));
  const minTrades = Math.max(0, Number(url.searchParams.get("minTrades") || 0) || 0);
  const minUniqueInsiders = Math.max(
    0,
    Number(url.searchParams.get("minUniqueInsiders") || 0) || 0
  );
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const search = String(url.searchParams.get("search") || "").trim();
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = parseSortKey(url.searchParams.get("sort"));
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterSentimentRows(cache.rows, {
    minScore,
    minTrades,
    minUniqueInsiders,
    sector,
    marketCap,
    search,
  });
  const sorted = sortSentimentRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    summary: summarizeSentiment(sorted),
    sectors: cache.sectors,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    rows: sorted.slice(offset, offset + pageSize),
  };
}

export { getCachedInsiderSentiment, parseDateMs };

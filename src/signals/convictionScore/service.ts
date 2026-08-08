import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getCachedConvictionScore, getOrComputeConvictionScore } from "./cache.js";
import { computeConvictionScores } from "./compute.js";
import type {
  ConvictionScoreCachePayload,
  ConvictionScorePayload,
  ConvictionScoreRow,
  MarketCapBucket,
} from "./types.js";
import { DEFAULT_CONVICTION_THRESHOLDS } from "./types.js";

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

export function filterConvictionScoreRows(
  rows: ConvictionScoreRow[],
  options: {
    quarter?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    minScore?: number;
    minHolders?: number;
    minMedianWeight?: number | null;
    minHighConvictionHolders?: number;
    includeInsufficient?: boolean;
    search?: string;
    tickers?: string[];
  }
): ConvictionScoreRow[] {
  const q = String(options.search || "")
    .trim()
    .toLowerCase();
  const minScore = Number(options.minScore) || 0;
  const minHolders = Number(options.minHolders) || 0;
  const minHigh = Number(options.minHighConvictionHolders) || 0;
  const tickerSet =
    options.tickers?.length
      ? new Set(options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))
      : null;

  return rows.filter((row) => {
    if (!options.includeInsufficient && row.insufficientData) return false;
    if (options.quarter && row.quarter !== options.quarter) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (minScore > 0 && (row.convictionScore == null || row.convictionScore < minScore)) {
      return false;
    }
    if (row.institutionalHolders < minHolders) return false;
    if (
      options.minMedianWeight != null &&
      row.medianPortfolioWeight < options.minMedianWeight
    ) {
      return false;
    }
    if (row.holdersAbove2Percent < minHigh) return false;
    if (tickerSet && !tickerSet.has(row.ticker)) return false;
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

export function sortConvictionScoreRows(
  rows: ConvictionScoreRow[],
  sortKey: string,
  sortDir: "asc" | "desc"
): ConvictionScoreRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (
      sortKey === "ticker" ||
      sortKey === "companyName" ||
      sortKey === "sector" ||
      sortKey === "classification" ||
      sortKey === "quarter"
    ) {
      const av = String(
        sortKey === "companyName"
          ? a.companyName || a.ticker
          : (a[sortKey as keyof ConvictionScoreRow] as string) || ""
      ).toLowerCase();
      const bv = String(
        sortKey === "companyName"
          ? b.companyName || b.ticker
          : (b[sortKey as keyof ConvictionScoreRow] as string) || ""
      ).toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    const key =
      sortKey === "highConvictionHolders"
        ? "holdersAbove2Percent"
        : sortKey === "persistence"
          ? "averageAccumulationStreak"
          : sortKey;
    const ax = Number(a[key as keyof ConvictionScoreRow]);
    const bx = Number(b[key as keyof ConvictionScoreRow]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

function summarize(
  rows: ConvictionScoreRow[],
  cache: ConvictionScoreCachePayload
): ConvictionScorePayload["summary"] {
  let highest: ConvictionScorePayload["summary"]["highestConviction"] = null;
  let sum = 0;
  let count = 0;
  let high = 0;
  let exceptional = 0;
  for (const row of rows) {
    if (row.insufficientData || row.convictionScore == null) continue;
    const score = row.convictionScore;
    sum += score;
    count += 1;
    if (score >= 75) high += 1;
    if (score >= 90) exceptional += 1;
    if (!highest || score > highest.score) {
      highest = {
        ticker: row.ticker,
        companyName: row.companyName,
        score,
      };
    }
  }
  return {
    highestConviction: highest,
    averageConviction: count ? Math.round((sum / count) * 10) / 10 : null,
    highConvictionStocks: high,
    exceptionalConvictionStocks: exceptional,
    currentQuarter: cache.currentQuarter,
    previousQuarter: cache.previousQuarter,
  };
}

export async function loadConvictionScoreCache(
  pool: pg.Pool = getPool()
): Promise<ConvictionScoreCachePayload> {
  return getOrComputeConvictionScore(() => computeConvictionScores(pool));
}

export async function getConvictionScore(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<ConvictionScorePayload> {
  const cache = await loadConvictionScoreCache(pool);
  const quarter =
    String(url.searchParams.get("quarter") || "").trim() || cache.currentQuarter || "";
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const minHolders = Math.max(
    0,
    Number(url.searchParams.get("minHolders") || cache.thresholds.minHolders || 0) || 0
  );
  const minMedianWeight = parseOptionalNumber(url.searchParams.get("minMedianWeight"));
  const minHighConvictionHolders = Math.max(
    0,
    Number(url.searchParams.get("minHighConvictionHolders") || 0) || 0
  );
  const includeInsufficient =
    url.searchParams.get("includeInsufficient") === "1" ||
    url.searchParams.get("includeInsufficient") === "true";
  const search = String(url.searchParams.get("search") || "").trim();
  const compareRaw = String(url.searchParams.get("compare") || "").trim();
  const tickers = compareRaw
    ? compareRaw.split(/[,+\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean)
    : undefined;
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = url.searchParams.get("sort") || "convictionScore";
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterConvictionScoreRows(cache.signals, {
    quarter,
    sector,
    marketCap,
    minScore,
    minHolders,
    minMedianWeight:
      minMedianWeight != null && minMedianWeight > 1
        ? minMedianWeight / 100
        : minMedianWeight,
    minHighConvictionHolders,
    includeInsufficient,
    search,
    tickers,
  });
  const sorted = sortConvictionScoreRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    currentQuarter: cache.currentQuarter,
    previousQuarter: cache.previousQuarter,
    quarters: cache.quarters,
    thresholds: cache.thresholds ?? DEFAULT_CONVICTION_THRESHOLDS,
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

export { getCachedConvictionScore, DEFAULT_CONVICTION_THRESHOLDS };

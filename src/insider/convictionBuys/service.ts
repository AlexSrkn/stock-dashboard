import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getOrComputeConvictionBuys, getCachedConvictionBuys } from "./cache.js";
import { computeConvictionBuys } from "./compute.js";
import { parseDateMs } from "./score.js";
import { resolveConvictionRole } from "./roleWeights.js";
import type {
  ConvictionBuyRow,
  ConvictionBuysPayload,
  ConvictionBuysSummary,
  ConvictionSortKey,
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

function parseSortKey(raw: string | null): ConvictionSortKey {
  const allowed: ConvictionSortKey[] = [
    "convictionScore",
    "valueUsd",
    "filingDate",
    "purchasesLast12Months",
    "ownershipIncreasePercent",
    "transactionDate",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as ConvictionSortKey;
  return "convictionScore";
}

function roleMatches(row: ConvictionBuyRow, roleFilter: string): boolean {
  if (!roleFilter) return true;
  const want = roleFilter.trim().toLowerCase();
  if (!want) return true;
  const resolved = resolveConvictionRole(row.insiderTitle).toLowerCase();
  if (resolved === want) return true;
  if (want === "10% owner" || want === "10-owner" || want === "ten-percent-owner") {
    return resolved === "10% owner";
  }
  return row.role.toLowerCase() === want || String(row.insiderTitle || "").toLowerCase().includes(want);
}

export function filterConvictionBuyRows(
  rows: ConvictionBuyRow[],
  options: {
    minScore?: number;
    dateFrom?: string | null;
    dateTo?: string | null;
    role?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    ticker?: string;
  }
): ConvictionBuyRow[] {
  const minScore = Number(options.minScore) || 0;
  const fromMs = options.dateFrom ? parseDateMs(options.dateFrom) : Number.NaN;
  const toMs = options.dateTo ? parseDateMs(options.dateTo) : Number.NaN;
  const ticker = String(options.ticker || "")
    .trim()
    .toUpperCase();

  return rows.filter((row) => {
    if (row.convictionScore < minScore) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (ticker && row.ticker !== ticker) return false;
    if (!roleMatches(row, options.role || "")) return false;

    const dateMs = parseDateMs(row.transactionDate) || parseDateMs(row.filingDate);
    if (Number.isFinite(fromMs) && Number.isFinite(dateMs) && dateMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(dateMs) && dateMs > toMs + 86_400_000 - 1) {
      return false;
    }
    return true;
  });
}

export function sortConvictionBuyRows(
  rows: ConvictionBuyRow[],
  sortKey: ConvictionSortKey,
  sortDir: "asc" | "desc"
): ConvictionBuyRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "filingDate" || sortKey === "transactionDate") {
      const av = parseDateMs(a[sortKey]) || 0;
      const bv = parseDateMs(b[sortKey]) || 0;
      return (av - bv) * dir || b.convictionScore - a.convictionScore;
    }
    const ax = Number(a[sortKey]);
    const bx = Number(b[sortKey]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export function summarizeConvictionBuys(rows: ConvictionBuyRow[]): ConvictionBuysSummary {
  if (!rows.length) {
    return {
      highestConvictionTrade: null,
      averageConvictionScore: 0,
      highConvictionBuys: 0,
      totalCapitalDeployed: 0,
    };
  }
  let sumScore = 0;
  let totalCapital = 0;
  let high = 0;
  let best = rows[0];
  for (const row of rows) {
    sumScore += row.convictionScore;
    totalCapital += row.valueUsd;
    if (row.convictionScore >= 70) high += 1;
    if (
      row.convictionScore > best.convictionScore ||
      (row.convictionScore === best.convictionScore && row.valueUsd > best.valueUsd)
    ) {
      best = row;
    }
  }
  return {
    highestConvictionTrade: {
      ticker: best.ticker,
      insiderName: best.insiderName,
      convictionScore: best.convictionScore,
      valueUsd: best.valueUsd,
    },
    averageConvictionScore: Math.round((sumScore / rows.length) * 10) / 10,
    highConvictionBuys: high,
    totalCapitalDeployed: Math.round(totalCapital * 100) / 100,
  };
}

export async function loadConvictionBuysCache(
  pool: pg.Pool = getPool()
): Promise<import("./types.js").ConvictionBuysCachePayload> {
  return getOrComputeConvictionBuys(() => computeConvictionBuys(pool));
}

export async function getConvictionBuys(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<ConvictionBuysPayload> {
  const cache = await loadConvictionBuysCache(pool);
  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const dateFrom = url.searchParams.get("dateFrom") || url.searchParams.get("from");
  const dateTo = url.searchParams.get("dateTo") || url.searchParams.get("to");
  const role = String(url.searchParams.get("role") || "").trim();
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const ticker = String(url.searchParams.get("ticker") || "").trim();
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = parseSortKey(url.searchParams.get("sort"));
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterConvictionBuyRows(cache.rows, {
    minScore,
    dateFrom,
    dateTo,
    role,
    sector,
    marketCap,
    ticker,
  });
  const sorted = sortConvictionBuyRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    summary: summarizeConvictionBuys(sorted),
    sectors: cache.sectors,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    rows: sorted.slice(offset, offset + pageSize),
  };
}

export { getCachedConvictionBuys };

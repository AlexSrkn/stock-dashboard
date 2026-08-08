import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getOrComputeConflictSignals, getCachedConflictSignals } from "./cache.js";
import { computeConflictSignals, DEFAULT_INSIDER_WINDOW_DAYS } from "./compute.js";
import type {
  ConflictSignalRow,
  ConflictSignalsCachePayload,
  ConflictSignalsPayload,
  ConflictSignalType,
  InsiderRoleFilter,
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

export function parseSignalType(raw: string | null): ConflictSignalType | "" {
  if (
    raw === "institutions_buying_insiders_selling" ||
    raw === "institutions_selling_insiders_buying" ||
    raw === "strong_divergence" ||
    raw === "double_conviction_conflict"
  ) {
    return raw;
  }
  return "";
}

export function parseInsiderRole(raw: string | null): InsiderRoleFilter {
  if (raw === "ceo" || raw === "cfo" || raw === "director" || raw === "officer") return raw;
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

function matchesInsiderRole(row: ConflictSignalRow, role: InsiderRoleFilter): boolean {
  if (!role) return true;
  return !!row.insiderRoles?.[role];
}

export function filterConflictSignalRows(
  rows: ConflictSignalRow[],
  options: {
    signalType?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    minConflictScore?: number;
    insiderRole?: InsiderRoleFilter;
    search?: string;
  }
): ConflictSignalRow[] {
  const minScore = Number(options.minConflictScore) || 0;
  const q = String(options.search || "")
    .trim()
    .toLowerCase();
  const signalType = options.signalType || "";

  return rows.filter((row) => {
    if (signalType && !row.signalTypes.includes(signalType as ConflictSignalType)) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (row.conflictScore < minScore) return false;
    if (!matchesInsiderRole(row, options.insiderRole || "")) return false;
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

export function sortConflictSignalRows(
  rows: ConflictSignalRow[],
  sortKey: string,
  sortDir: "asc" | "desc"
): ConflictSignalRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker" || sortKey === "companyName" || sortKey === "sector" || sortKey === "signalType") {
      const av = String(
        sortKey === "companyName" ? a.companyName || a.ticker : a[sortKey as keyof ConflictSignalRow] || ""
      ).toLowerCase();
      const bv = String(
        sortKey === "companyName" ? b.companyName || b.ticker : b[sortKey as keyof ConflictSignalRow] || ""
      ).toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    const ax = Number(a[sortKey as keyof ConflictSignalRow]);
    const bx = Number(b[sortKey as keyof ConflictSignalRow]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export async function loadConflictSignalsCache(
  pool: pg.Pool = getPool()
): Promise<ConflictSignalsCachePayload> {
  return getOrComputeConflictSignals(() =>
    computeConflictSignals(pool, DEFAULT_INSIDER_WINDOW_DAYS)
  );
}

export async function getConflictSignals(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<ConflictSignalsPayload> {
  const cache = await loadConflictSignalsCache(pool);
  const signalType = parseSignalType(url.searchParams.get("signalType"));
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const minConflictScore = Math.max(0, Number(url.searchParams.get("minConflictScore") || 0) || 0);
  const insiderRole = parseInsiderRole(url.searchParams.get("insiderRole"));
  const search = String(url.searchParams.get("search") || "").trim();
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = url.searchParams.get("sort") || "conflictScore";
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterConflictSignalRows(cache.signals, {
    signalType,
    sector,
    marketCap,
    minConflictScore,
    insiderRole,
    search,
  });
  const sorted = sortConflictSignalRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;
  const pageRows = sorted.slice(offset, offset + pageSize);

  return {
    computedAt: cache.computedAt,
    currentQuarter: cache.currentQuarter,
    previousQuarter: cache.previousQuarter,
    insiderWindowDays: cache.insiderWindowDays,
    summary: {
      ...cache.summary,
      totalSignals: total,
    },
    sectors: cache.sectors,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    signals: pageRows,
  };
}

export { getCachedConflictSignals, DEFAULT_INSIDER_WINDOW_DAYS };


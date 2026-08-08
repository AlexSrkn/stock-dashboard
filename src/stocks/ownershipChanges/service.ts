import type pg from "pg";
import { getPool } from "../../db/pool.js";
import {
  getCachedOwnershipChanges,
  setOwnershipChangesMemoryCache,
} from "./cache.js";
import {
  buildOwnershipChangesSummary,
  computeOwnershipChangesCache,
  filterOwnershipChangeRows,
  paginateRows,
  parseMarketCapBucket,
  parseOwnershipChangeDirection,
  parseOwnershipChangesQuarter,
} from "./compute.js";
import type { OwnershipChangeRow, OwnershipChangesCachePayload, OwnershipChangesPayload } from "./types.js";

let inflight: Promise<OwnershipChangesCachePayload> | null = null;

export async function loadOwnershipChangesCache(
  pool: pg.Pool = getPool()
): Promise<OwnershipChangesCachePayload> {
  const cached = getCachedOwnershipChanges();
  if (cached) return cached;

  if (!inflight) {
    inflight = computeOwnershipChangesCache(pool)
      .then((payload) => {
        setOwnershipChangesMemoryCache(payload);
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

function parsePage(raw: string | null, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function parsePageSize(raw: string | null, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(10, Math.floor(n)));
}

function sortOwnershipChangeRows(
  rows: OwnershipChangeRow[],
  sortKey: string,
  sortDir: "asc" | "desc"
): OwnershipChangeRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      const al = String(a.companyName || a.ticker || "");
      const bl = String(b.companyName || b.ticker || "");
      return al.localeCompare(bl) * dir;
    }
    if (sortKey === "currentQuarter") {
      return String(a.currentQuarter || "").localeCompare(String(b.currentQuarter || "")) * dir;
    }
    const ax = Number(a[sortKey as keyof OwnershipChangeRow]);
    const bx = Number(b[sortKey as keyof OwnershipChangeRow]);
    if (Number.isFinite(ax) && Number.isFinite(bx)) return (ax - bx) * dir;
    return 0;
  });
}

export async function getOwnershipChanges(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<OwnershipChangesPayload> {
  const cache = await loadOwnershipChangesCache(pool);
  const quarter = parseOwnershipChangesQuarter(url.searchParams.get("quarter"), cache.quarters);
  const direction = parseOwnershipChangeDirection(url.searchParams.get("direction"));
  const search = url.searchParams.get("search") || "";
  const sector = url.searchParams.get("sector") || "";
  const exchange = url.searchParams.get("exchange") || "";
  const marketCap = parseMarketCapBucket(
    url.searchParams.get("marketCap") || url.searchParams.get("size")
  );
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sortKey = url.searchParams.get("sort") || "changePct";
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : direction === "decreases"
        ? "asc"
        : "desc";

  const allRows = quarter ? (cache.byQuarter[quarter] ?? []) : [];
  const filtered = filterOwnershipChangeRows(allRows, {
    direction,
    search,
    sector: sector || undefined,
    exchange: exchange || undefined,
    marketCap: marketCap || undefined,
  });
  const sorted = sortOwnershipChangeRows(filtered, sortKey, sortDir);
  const { rows, total } = paginateRows(sorted, page, pageSize);
  const previousQuarter = rows[0]?.previousQuarter ?? (quarter ? findPreviousQuarter(cache, quarter) : null);

  return {
    computedAt: cache.computedAt,
    quarter: quarter ?? "",
    previousQuarter: previousQuarter ?? "",
    direction,
    summary: buildOwnershipChangesSummary(filtered),
    sectors: cache.sectors,
    exchanges: cache.exchanges,
    quarters: cache.quarters,
    page,
    pageSize,
    total,
    stocks: rows,
  };
}

function findPreviousQuarter(
  cache: Awaited<ReturnType<typeof loadOwnershipChangesCache>>,
  quarter: string
): string | null {
  const idx = cache.quarters.indexOf(quarter);
  if (idx < 0) return null;
  const row = cache.byQuarter[quarter]?.[0];
  return row?.previousQuarter ?? null;
}

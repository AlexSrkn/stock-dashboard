import type {
  NewInstitutionalPositionRow,
  NewPositionsPayload,
  NewPositionsSummary,
} from "./types.js";

export type NewPositionsSortKey =
  | "companyName"
  | "ticker"
  | "institutionName"
  | "positionValueUsd"
  | "portfolioWeightPct"
  | "filingDate";

export type NewPositionsSortDir = "asc" | "desc";

export interface NewPositionsQuery {
  quarter?: string;
  institution?: string;
  sector?: string;
  minValue?: number;
  minWeight?: number;
  search?: string;
  sort?: NewPositionsSortKey;
  sortDir?: NewPositionsSortDir;
  page?: number;
  pageSize?: number;
}

export interface NewPositionsQueryResult {
  computedAt: string;
  quarters: string[];
  sectors: string[];
  institutions: NewPositionsPayload["institutions"];
  summary: NewPositionsSummary;
  positions: NewInstitutionalPositionRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export function parseNewPositionsSortKey(raw: string | null): NewPositionsSortKey {
  const keys: NewPositionsSortKey[] = [
    "companyName",
    "ticker",
    "institutionName",
    "positionValueUsd",
    "portfolioWeightPct",
    "filingDate",
  ];
  if (raw && keys.includes(raw as NewPositionsSortKey)) return raw as NewPositionsSortKey;
  return "positionValueUsd";
}

export function parseNewPositionsSortDir(raw: string | null): NewPositionsSortDir {
  return raw === "asc" ? "asc" : "desc";
}

function matchesFilters(row: NewInstitutionalPositionRow, query: NewPositionsQuery): boolean {
  if (query.quarter && row.quarter !== query.quarter) return false;
  if (query.institution && row.institutionId !== query.institution) return false;
  if (query.sector && row.sector !== query.sector) return false;
  if (
    (query.minValue ?? 0) > 0 &&
    (row.positionValueUsd == null || row.positionValueUsd < (query.minValue ?? 0))
  ) {
    return false;
  }
  if (
    (query.minWeight ?? 0) > 0 &&
    (row.portfolioWeightPct == null || row.portfolioWeightPct < (query.minWeight ?? 0))
  ) {
    return false;
  }
  const q = (query.search ?? "").trim().toLowerCase();
  if (!q) return true;
  const ticker = String(row.ticker || "").toLowerCase();
  const company = String(row.companyName || "").toLowerCase();
  const institution = String(row.institutionName || "").toLowerCase();
  return ticker.includes(q) || company.includes(q) || institution.includes(q);
}

function compareRows(
  a: NewInstitutionalPositionRow,
  b: NewInstitutionalPositionRow,
  key: NewPositionsSortKey,
  dir: NewPositionsSortDir
): number {
  const sign = dir === "asc" ? 1 : -1;
  if (key === "companyName") {
    const av = String(a.companyName || a.ticker || "").toLowerCase();
    const bv = String(b.companyName || b.ticker || "").toLowerCase();
    return av.localeCompare(bv) * sign;
  }
  if (key === "ticker") {
    return String(a.ticker || "").localeCompare(String(b.ticker || "")) * sign;
  }
  if (key === "institutionName") {
    return String(a.institutionName || "").localeCompare(String(b.institutionName || "")) * sign;
  }
  if (key === "filingDate") {
    const av = Date.parse(a.filingDate || "") || 0;
    const bv = Date.parse(b.filingDate || "") || 0;
    return (av - bv) * sign;
  }
  const av = Number(a[key]);
  const bv = Number(b[key]);
  const an = Number.isFinite(av)
    ? av
    : sign < 0
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  const bn = Number.isFinite(bv)
    ? bv
    : sign < 0
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  return (an - bn) * sign;
}

let cachedPayload: NewPositionsPayload | null = null;
const sortedCache = new Map<string, NewInstitutionalPositionRow[]>();

function sortedPositions(
  payload: NewPositionsPayload,
  sort: NewPositionsSortKey,
  sortDir: NewPositionsSortDir
): NewInstitutionalPositionRow[] {
  if (cachedPayload !== payload) {
    sortedCache.clear();
    cachedPayload = payload;
  }
  const key = `${sort}:${sortDir}`;
  let sorted = sortedCache.get(key);
  if (!sorted) {
    sorted = [...payload.positions].sort((a, b) => compareRows(a, b, sort, sortDir));
    sortedCache.set(key, sorted);
  }
  return sorted;
}

export function queryNewInstitutionalPositions(
  payload: NewPositionsPayload,
  query: NewPositionsQuery
): NewPositionsQueryResult {
  const sort = query.sort ?? "positionValueUsd";
  const sortDir = query.sortDir ?? "desc";
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE)
  );
  const page = Math.max(1, query.page ?? 1);

  const filtered = sortedPositions(payload, sort, sortDir).filter((row) =>
    matchesFilters(row, query)
  );

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;

  return {
    computedAt: payload.computedAt,
    quarters: payload.quarters,
    sectors: payload.sectors,
    institutions: page === 1 ? payload.institutions : [],
    summary: payload.summary,
    positions: filtered.slice(start, start + pageSize),
    pagination: {
      page: safePage,
      pageSize,
      total,
      pageCount,
    },
  };
}

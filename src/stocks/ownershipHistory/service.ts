import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getOrComputeOwnershipHistory, getCachedOwnershipHistory } from "./cache.js";
import { computeOwnershipHistoryCache } from "./compute.js";
import type {
  OwnershipHistoryCategory,
  OwnershipHistoryHighlight,
  OwnershipHistoryPayload,
  OwnershipHistoryRow,
  OwnershipHistorySummary,
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

export function parseCategory(raw: string | null): OwnershipHistoryCategory | "" {
  if (
    raw === "ownership_expansion" ||
    raw === "institutional_adoption" ||
    raw === "early_discovery" ||
    raw === "ownership_decliner"
  ) {
    return raw;
  }
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

export function filterOwnershipHistoryRows(
  rows: OwnershipHistoryRow[],
  options: {
    category?: OwnershipHistoryCategory | "";
    sector?: string;
    marketCap?: MarketCapBucket;
    minOwnershipGrowth?: number | null;
    maxOwnershipPct?: number | null;
    minHolderGrowth?: number | null;
    search?: string;
  }
): OwnershipHistoryRow[] {
  const q = String(options.search || "")
    .trim()
    .toLowerCase();

  return rows.filter((row) => {
    if (options.category && row.category !== options.category) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (
      options.minOwnershipGrowth != null &&
      row.ownershipChange < options.minOwnershipGrowth
    ) {
      return false;
    }
    if (
      options.maxOwnershipPct != null &&
      row.currentInstitutionalOwnership > options.maxOwnershipPct
    ) {
      return false;
    }
    if (options.minHolderGrowth != null && row.holderChange < options.minHolderGrowth) {
      return false;
    }
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

export function sortOwnershipHistoryRows(
  rows: OwnershipHistoryRow[],
  sortKey: string,
  sortDir: "asc" | "desc"
): OwnershipHistoryRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (
      sortKey === "ticker" ||
      sortKey === "companyName" ||
      sortKey === "sector" ||
      sortKey === "category"
    ) {
      const av = String(
        sortKey === "companyName" ? a.companyName || a.ticker : a[sortKey as keyof OwnershipHistoryRow] || ""
      ).toLowerCase();
      const bv = String(
        sortKey === "companyName" ? b.companyName || b.ticker : b[sortKey as keyof OwnershipHistoryRow] || ""
      ).toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    // Alias sort keys from the product spec
    const keyMap: Record<string, keyof OwnershipHistoryRow> = {
      ownership_expansion_score: "ownershipExpansionScore",
      holder_growth: "holderChange",
      new_institutions: "newInstitutions",
      ownership_decline: "ownershipDeclineScore",
      ownershipExpansionScore: "ownershipExpansionScore",
      holderChange: "holderChange",
      newInstitutions: "newInstitutions",
      ownershipDeclineScore: "ownershipDeclineScore",
      ownershipChange: "ownershipChange",
      institutionalAdoptionScore: "institutionalAdoptionScore",
      earlyDiscoveryScore: "earlyDiscoveryScore",
      currentInstitutionalOwnership: "currentInstitutionalOwnership",
      currentHolderCount: "currentHolderCount",
    };
    const field = keyMap[sortKey] || (sortKey as keyof OwnershipHistoryRow);
    const ax = Number(a[field]);
    const bx = Number(b[field]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

function highlight(
  row: OwnershipHistoryRow | undefined,
  value: number,
  label: string
): OwnershipHistoryHighlight | null {
  if (!row) return null;
  return {
    ticker: row.ticker,
    companyName: row.companyName,
    value,
    label,
  };
}

export function buildOwnershipHistorySummary(
  rows: OwnershipHistoryRow[],
  currentQuarter: string,
  previousQuarter: string | null
): OwnershipHistorySummary {
  if (!rows.length) {
    return {
      fastestGrowth: null,
      biggestHolderIncrease: null,
      biggestDecline: null,
      newDiscoveries: null,
      stockCount: 0,
      currentQuarter,
      previousQuarter,
    };
  }

  const byOwnChange = [...rows].sort((a, b) => b.ownershipChange - a.ownershipChange);
  const byHolders = [...rows].sort((a, b) => b.holderChange - a.holderChange);
  const byDecline = [...rows].sort((a, b) => a.ownershipChange - b.ownershipChange);
  const byEarly = [...rows]
    .filter((r) => r.category === "early_discovery" || r.earlyDiscoveryScore > 0)
    .sort((a, b) => b.earlyDiscoveryScore - a.earlyDiscoveryScore);

  const topGrowth = byOwnChange[0];
  const topHolders = byHolders[0];
  const topDecline = byDecline[0];
  const topEarly = byEarly[0];

  return {
    fastestGrowth: highlight(
      topGrowth,
      topGrowth?.ownershipChange ?? 0,
      topGrowth ? `${topGrowth.ownershipChange >= 0 ? "+" : ""}${topGrowth.ownershipChange.toFixed(1)} pts` : ""
    ),
    biggestHolderIncrease: highlight(
      topHolders,
      topHolders?.holderChange ?? 0,
      topHolders ? `${topHolders.holderChange >= 0 ? "+" : ""}${topHolders.holderChange} holders` : ""
    ),
    biggestDecline: highlight(
      topDecline && topDecline.ownershipChange < 0 ? topDecline : undefined,
      topDecline?.ownershipChange ?? 0,
      topDecline && topDecline.ownershipChange < 0
        ? `${topDecline.ownershipChange.toFixed(1)} pts`
        : ""
    ),
    newDiscoveries: highlight(
      topEarly,
      topEarly?.earlyDiscoveryScore ?? 0,
      topEarly ? `score ${topEarly.earlyDiscoveryScore.toFixed(1)}` : ""
    ),
    stockCount: rows.length,
    currentQuarter,
    previousQuarter,
  };
}

export async function loadOwnershipHistoryCache(
  pool: pg.Pool = getPool()
) {
  return getOrComputeOwnershipHistory(() => computeOwnershipHistoryCache(pool));
}

export async function getOwnershipHistory(
  url: URL,
  pool: pg.Pool = getPool()
): Promise<OwnershipHistoryPayload> {
  const cache = await loadOwnershipHistoryCache(pool);
  const quarter =
    String(url.searchParams.get("quarter") || "").trim() || cache.currentQuarter || "";
  const category = parseCategory(url.searchParams.get("category"));
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const minOwnershipGrowth = parseOptionalNumber(url.searchParams.get("minOwnershipGrowth"));
  const maxOwnershipPct = parseOptionalNumber(url.searchParams.get("maxOwnershipPct"));
  const minHolderGrowth = parseOptionalNumber(url.searchParams.get("minHolderGrowth"));
  const search = String(url.searchParams.get("search") || "").trim();
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = url.searchParams.get("sort") || "ownershipExpansionScore";
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : sort === "ownership_decline" || sort === "ownershipDeclineScore"
        ? "desc"
        : "desc";

  const allRows = quarter ? (cache.byQuarter[quarter] ?? []) : [];
  const filtered = filterOwnershipHistoryRows(allRows, {
    category,
    sector,
    marketCap,
    minOwnershipGrowth,
    maxOwnershipPct,
    minHolderGrowth,
    search,
  });
  const sorted = sortOwnershipHistoryRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;
  const pageRows = sorted.slice(offset, offset + pageSize);

  const prevQ =
    pageRows[0]?.previousQuarter ||
    allRows[0]?.previousQuarter ||
    cache.previousQuarter;

  return {
    computedAt: cache.computedAt,
    currentQuarter: quarter || cache.currentQuarter,
    previousQuarter: prevQ,
    quarters: cache.quarters,
    sectors: cache.sectors,
    summary: buildOwnershipHistorySummary(sorted, quarter || cache.currentQuarter, prevQ),
    page,
    pageSize,
    total,
    sort,
    sortDir,
    category,
    stocks: pageRows,
  };
}

export { getCachedOwnershipHistory };


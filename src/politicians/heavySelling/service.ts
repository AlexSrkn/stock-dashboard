import {
  DEFAULT_MULTIPLE_SELLERS_MIN,
  DEFAULT_MULTIPLE_SELLERS_WINDOW_DAYS,
} from "./config.js";
import { computePoliticianHeavySelling } from "./compute.js";
import { parseDateMs, round2 } from "./dates.js";
import type {
  MarketCapBucket,
  PoliticianHeavySellingCachePayload,
  PoliticianHeavySellingPayload,
  PoliticianHeavySellingRow,
  PoliticianHeavySellingSortKey,
  PoliticianHeavySellingSummary,
} from "./types.js";

let memoryCache: {
  loadedAt: number;
  windowDays: number;
  minSellers: number;
  payload: PoliticianHeavySellingCachePayload;
} | null = null;
const MEMORY_CACHE_MS = 5 * 60 * 1000;

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

function parseSortKey(raw: string | null): PoliticianHeavySellingSortKey {
  const allowed: PoliticianHeavySellingSortKey[] = [
    "estimatedTotalSold",
    "uniqueSellers",
    "sellTransactions",
    "largestSale",
    "latestSale",
    "ticker",
    "currentConsecutiveSales",
    "multipleSellers",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as PoliticianHeavySellingSortKey;
  return "estimatedTotalSold";
}

export function filterPoliticianHeavySellingRows(
  rows: PoliticianHeavySellingRow[],
  options: {
    dateFrom?: string | null;
    dateTo?: string | null;
    politician?: string;
    party?: string;
    chamber?: string;
    state?: string;
    sector?: string;
    marketCap?: MarketCapBucket;
    ticker?: string;
    search?: string;
    minEstimatedSale?: number;
    minUniqueSellers?: number;
    consecutiveOnly?: boolean;
    multipleSellersOnly?: boolean;
  }
): PoliticianHeavySellingRow[] {
  const fromMs = options.dateFrom ? parseDateMs(options.dateFrom) : Number.NaN;
  const toMs = options.dateTo ? parseDateMs(options.dateTo) : Number.NaN;
  const politician = String(options.politician || "")
    .trim()
    .toLowerCase();
  const party = String(options.party || "")
    .trim()
    .toLowerCase();
  const chamber = String(options.chamber || "")
    .trim()
    .toLowerCase();
  const state = String(options.state || "")
    .trim()
    .toUpperCase();
  const ticker = String(options.ticker || "")
    .trim()
    .toUpperCase();
  const q = String(options.search || "")
    .trim()
    .toLowerCase();
  const minSale = Number(options.minEstimatedSale) || 0;
  const minSellers = Number(options.minUniqueSellers) || 0;

  return rows.filter((row) => {
    if (options.multipleSellersOnly && !row.multipleSellers) return false;
    if (options.consecutiveOnly && row.currentConsecutiveSales < 2) return false;
    if (minSellers > 0 && row.uniqueSellers < minSellers) return false;
    if (minSale > 0 && row.largestSale < minSale) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (ticker && row.ticker !== ticker) return false;

    if (chamber && chamber !== "all") {
      const hasChamber = row.sellers.some((s) => s.chamber === chamber);
      if (!hasChamber) return false;
    }
    if (state) {
      const hasState = row.sellers.some((s) => String(s.state || "").toUpperCase() === state);
      if (!hasState) return false;
    }
    if (party) {
      const hasParty = row.sellers.some(
        (s) => String(s.party || "").toLowerCase() === party
      );
      if (!hasParty) return false;
    }
    if (politician) {
      const hasPol = row.sellers.some(
        (s) =>
          s.politicianKey === politician ||
          s.politicianName.toLowerCase().includes(politician)
      );
      if (!hasPol) return false;
    }

    const latestMs = parseDateMs(row.latestSale);
    if (Number.isFinite(fromMs) && Number.isFinite(latestMs) && latestMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(latestMs) && latestMs > toMs + 86_400_000 - 1) {
      return false;
    }

    if (!q) return true;
    const sellerNames = row.sellers.map((s) => s.politicianName).join(" ");
    const hay = `${row.ticker} ${row.companyName || ""} ${sellerNames}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortPoliticianHeavySellingRows(
  rows: PoliticianHeavySellingRow[],
  sortKey: PoliticianHeavySellingSortKey,
  sortDir: "asc" | "desc"
): PoliticianHeavySellingRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      return a.ticker.localeCompare(b.ticker) * dir;
    }
    if (sortKey === "latestSale") {
      const av = parseDateMs(a.latestSale) || 0;
      const bv = parseDateMs(b.latestSale) || 0;
      return (av - bv) * dir || a.ticker.localeCompare(b.ticker);
    }
    if (sortKey === "multipleSellers") {
      const av = a.multipleSellers ? 1 : 0;
      const bv = b.multipleSellers ? 1 : 0;
      return (av - bv) * dir || a.ticker.localeCompare(b.ticker);
    }
    const key =
      sortKey === "estimatedTotalSold"
        ? "estimatedTotalSold"
        : sortKey === "uniqueSellers"
          ? "uniqueSellers"
          : sortKey === "sellTransactions"
            ? "sellTransactions"
            : sortKey === "currentConsecutiveSales"
              ? "currentConsecutiveSales"
              : "largestSale";
    const ax = Number(a[key]);
    const bx = Number(b[key]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export function summarizePoliticianHeavySelling(
  rows: PoliticianHeavySellingRow[]
): PoliticianHeavySellingSummary {
  if (!rows.length) {
    return {
      largestEstimatedSale: null,
      stocksWithMultipleSellers: 0,
      activePoliticianSellers: 0,
      totalEstimatedValueSold: 0,
    };
  }

  let largest: PoliticianHeavySellingSummary["largestEstimatedSale"] = null;
  let total = 0;
  const pols = new Set<string>();
  let multi = 0;

  for (const row of rows) {
    total += row.estimatedTotalSold;
    if (row.multipleSellers) multi += 1;
    for (const s of row.sellers) pols.add(s.politicianKey);
    if (!largest || row.largestSale > largest.value) {
      const seller = row.sellers.find((s) => Math.abs(s.estimatedSold) >= 0) || row.sellers[0];
      // Prefer the seller whose estimated sold equals or is closest to largest sale isn't exact;
      // use largest sale value from the row and any seller name for display.
      largest = {
        ticker: row.ticker,
        companyName: row.companyName,
        politicianName: seller?.politicianName || "—",
        value: row.largestSale,
      };
    }
  }

  // Refine politician name for largest sale from sellers with matching sell activity
  for (const row of rows) {
    if (!largest || row.ticker !== largest.ticker) continue;
    // keep first matching ticker's seller with highest estimatedSold
    const top = [...row.sellers].sort((a, b) => b.estimatedSold - a.estimatedSold)[0];
    if (top) {
      largest = {
        ...largest,
        politicianName: top.politicianName,
        value: row.largestSale,
      };
    }
  }

  return {
    largestEstimatedSale: largest,
    stocksWithMultipleSellers: multi,
    activePoliticianSellers: pols.size,
    totalEstimatedValueSold: round2(total),
  };
}

export async function loadPoliticianHeavySellingCache(
  windowDays: number = DEFAULT_MULTIPLE_SELLERS_WINDOW_DAYS,
  minSellers: number = DEFAULT_MULTIPLE_SELLERS_MIN
): Promise<PoliticianHeavySellingCachePayload> {
  const now = Date.now();
  if (
    memoryCache &&
    memoryCache.windowDays === windowDays &&
    memoryCache.minSellers === minSellers &&
    now - memoryCache.loadedAt < MEMORY_CACHE_MS
  ) {
    return memoryCache.payload;
  }
  const payload = await computePoliticianHeavySelling({ windowDays, minSellers });
  memoryCache = { loadedAt: now, windowDays, minSellers, payload };
  return payload;
}

export function invalidatePoliticianHeavySellingCache(): void {
  memoryCache = null;
}

export async function getPoliticianHeavySelling(
  url: URL
): Promise<PoliticianHeavySellingPayload> {
  const windowRaw = Number(url.searchParams.get("windowDays"));
  const windowDays =
    Number.isFinite(windowRaw) && windowRaw >= 7 && windowRaw <= 365
      ? Math.floor(windowRaw)
      : DEFAULT_MULTIPLE_SELLERS_WINDOW_DAYS;
  const minClusterRaw = Number(url.searchParams.get("clusterMinSellers"));
  const clusterMin =
    Number.isFinite(minClusterRaw) && minClusterRaw >= 2
      ? Math.floor(minClusterRaw)
      : DEFAULT_MULTIPLE_SELLERS_MIN;

  const cache = await loadPoliticianHeavySellingCache(windowDays, clusterMin);
  if (!cache.fetchedAt && !cache.rows.length) {
    return {
      computedAt: cache.computedAt,
      fetchedAt: null,
      multipleSellersWindowDays: windowDays,
      multipleSellersMin: clusterMin,
      available: false,
      unavailableReason: "No politician data yet. Run: npm run politicians:fetch-recent",
      summary: {
        largestEstimatedSale: null,
        stocksWithMultipleSellers: 0,
        activePoliticianSellers: 0,
        totalEstimatedValueSold: 0,
      },
      sectors: [],
      politicians: [],
      states: [],
      parties: [],
      page: 1,
      pageSize: 50,
      total: 0,
      sort: "estimatedTotalSold",
      sortDir: "desc",
      rows: [],
      largestSales: [],
    };
  }

  const dateFrom = url.searchParams.get("dateFrom") || url.searchParams.get("from");
  const dateTo = url.searchParams.get("dateTo") || url.searchParams.get("to");
  const politician = String(url.searchParams.get("politician") || "").trim();
  const party = String(url.searchParams.get("party") || "").trim();
  const chamber = String(url.searchParams.get("chamber") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  const sector = String(url.searchParams.get("sector") || "").trim();
  const marketCap = parseMarketCapBucket(url.searchParams.get("marketCap"));
  const ticker = String(url.searchParams.get("ticker") || "").trim();
  const search = String(url.searchParams.get("search") || "").trim();
  const minEstimatedSale =
    Number(url.searchParams.get("minEstimatedSale") || url.searchParams.get("minSale") || 0) || 0;
  const minUniqueSellers =
    Number(url.searchParams.get("minUniqueSellers") || url.searchParams.get("minSellers") || 0) ||
    0;
  const consecutiveOnly =
    url.searchParams.get("consecutiveOnly") === "1" ||
    url.searchParams.get("consecutiveOnly") === "true";
  const multipleSellersOnly =
    url.searchParams.get("multipleSellersOnly") === "1" ||
    url.searchParams.get("multipleSellersOnly") === "true";
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = parseSortKey(url.searchParams.get("sort"));
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterPoliticianHeavySellingRows(cache.rows, {
    dateFrom,
    dateTo,
    politician,
    party,
    chamber,
    state,
    sector,
    marketCap,
    ticker,
    search,
    minEstimatedSale,
    minUniqueSellers,
    consecutiveOnly,
    multipleSellersOnly,
  });
  const sorted = sortPoliticianHeavySellingRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  const largestSales = cache.largestSales.filter((sale) => {
    if (ticker && sale.ticker !== ticker.toUpperCase()) return false;
    if (party && String(sale.party || "").toLowerCase() !== party.toLowerCase()) return false;
    if (chamber && chamber !== "all" && sale.chamber !== chamber) return false;
    if (state && String(sale.state || "").toUpperCase() !== state.toUpperCase()) return false;
    if (
      politician &&
      sale.politicianKey !== politician &&
      !sale.politicianName.toLowerCase().includes(politician.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return {
    computedAt: cache.computedAt,
    fetchedAt: cache.fetchedAt,
    multipleSellersWindowDays: cache.multipleSellersWindowDays,
    multipleSellersMin: cache.multipleSellersMin,
    available: true,
    unavailableReason: null,
    summary: summarizePoliticianHeavySelling(sorted),
    sectors: cache.sectors,
    politicians: cache.politicians,
    states: cache.states,
    parties: cache.parties,
    page,
    pageSize,
    total,
    sort,
    sortDir,
    rows: sorted.slice(offset, offset + pageSize),
    largestSales: largestSales.slice(0, 25),
  };
}

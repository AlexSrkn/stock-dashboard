import { computePoliticianRepeatBuyers } from "./compute.js";
import { parseDateMs, round1 } from "./score.js";
import type {
  MarketCapBucket,
  PoliticianRepeatBuyerRow,
  PoliticianRepeatBuyersCachePayload,
  PoliticianRepeatBuyersPayload,
  PoliticianRepeatBuyersSummary,
  PoliticianRepeatBuyerSortKey,
} from "./types.js";

let memoryCache: { loadedAt: number; payload: PoliticianRepeatBuyersCachePayload } | null = null;
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

function parseSortKey(raw: string | null): PoliticianRepeatBuyerSortKey {
  const allowed: PoliticianRepeatBuyerSortKey[] = [
    "repeatBuyerScore",
    "purchaseCount",
    "purchaseStreak",
    "estimatedTotalInvested",
    "latestPurchase",
    "purchasesLast12Months",
    "ticker",
    "politicianName",
    "party",
    "state",
    "classification",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as PoliticianRepeatBuyerSortKey;
  return "repeatBuyerScore";
}

export function filterPoliticianRepeatBuyerRows(
  rows: PoliticianRepeatBuyerRow[],
  options: {
    minScore?: number;
    minPurchases?: number;
    minStreak?: number;
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
  }
): PoliticianRepeatBuyerRow[] {
  const minScore = Number(options.minScore) || 0;
  const minPurchases = Number(options.minPurchases) || 0;
  const minStreak = Number(options.minStreak) || 0;
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

  return rows.filter((row) => {
    if (row.repeatBuyerScore < minScore) return false;
    if (row.purchaseCount < minPurchases) return false;
    if (row.purchaseStreak < minStreak) return false;
    if (options.sector && row.sector !== options.sector) return false;
    if (!matchesMarketCap(row.marketCapUsd, options.marketCap || "")) return false;
    if (ticker && row.ticker !== ticker) return false;
    if (chamber && chamber !== "all" && row.chamber !== chamber) return false;
    if (state && String(row.state || "").toUpperCase() !== state) return false;
    if (party && String(row.party || "").toLowerCase() !== party) return false;
    if (
      politician &&
      row.politicianKey !== politician &&
      !row.politicianName.toLowerCase().includes(politician)
    ) {
      return false;
    }

    const latestMs = parseDateMs(row.latestPurchase);
    if (Number.isFinite(fromMs) && Number.isFinite(latestMs) && latestMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(latestMs) && latestMs > toMs + 86_400_000 - 1) {
      return false;
    }

    if (!q) return true;
    const hay = `${row.ticker} ${row.companyName || ""} ${row.politicianName}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortPoliticianRepeatBuyerRows(
  rows: PoliticianRepeatBuyerRow[],
  sortKey: PoliticianRepeatBuyerSortKey,
  sortDir: "asc" | "desc"
): PoliticianRepeatBuyerRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      return a.ticker.localeCompare(b.ticker) * dir || b.repeatBuyerScore - a.repeatBuyerScore;
    }
    if (
      sortKey === "politicianName" ||
      sortKey === "party" ||
      sortKey === "state" ||
      sortKey === "classification"
    ) {
      const av = String(a[sortKey] || "");
      const bv = String(b[sortKey] || "");
      return av.localeCompare(bv) * dir || a.ticker.localeCompare(b.ticker);
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

export function summarizePoliticianRepeatBuyers(
  rows: PoliticianRepeatBuyerRow[]
): PoliticianRepeatBuyersSummary {
  if (!rows.length) {
    return {
      activeRepeatBuyers: 0,
      longestPurchaseStreak: 0,
      largestEstimatedInvestment: null,
      averageRepeatBuyerScore: null,
    };
  }

  let longest = 0;
  let largest = rows[0];
  let scoreSum = 0;
  let active = 0;
  for (const row of rows) {
    if (row.purchaseStreak > longest) longest = row.purchaseStreak;
    if (row.estimatedTotalInvested > largest.estimatedTotalInvested) largest = row;
    scoreSum += row.repeatBuyerScore;
    if (row.repeatBuyerScore >= 40) active += 1;
  }

  return {
    activeRepeatBuyers: active,
    longestPurchaseStreak: longest,
    largestEstimatedInvestment: {
      ticker: largest.ticker,
      politicianName: largest.politicianName,
      value: largest.estimatedTotalInvested,
    },
    averageRepeatBuyerScore: round1(scoreSum / rows.length),
  };
}

export async function loadPoliticianRepeatBuyersCache(): Promise<PoliticianRepeatBuyersCachePayload> {
  const now = Date.now();
  if (memoryCache && now - memoryCache.loadedAt < MEMORY_CACHE_MS) {
    return memoryCache.payload;
  }
  const payload = await computePoliticianRepeatBuyers();
  memoryCache = { loadedAt: now, payload };
  return payload;
}

export function invalidatePoliticianRepeatBuyersCache(): void {
  memoryCache = null;
}

export async function getPoliticianRepeatBuyers(url: URL): Promise<PoliticianRepeatBuyersPayload> {
  const cache = await loadPoliticianRepeatBuyersCache();
  if (!cache.fetchedAt && !cache.rows.length) {
    return {
      computedAt: cache.computedAt,
      fetchedAt: null,
      available: false,
      unavailableReason: "No politician data yet. Run: npm run politicians:fetch-recent",
      summary: {
        activeRepeatBuyers: 0,
        longestPurchaseStreak: 0,
        largestEstimatedInvestment: null,
        averageRepeatBuyerScore: null,
      },
      sectors: [],
      politicians: [],
      states: [],
      parties: [],
      page: 1,
      pageSize: 50,
      total: 0,
      sort: "repeatBuyerScore",
      sortDir: "desc",
      rows: [],
    };
  }

  const minScore = Math.max(0, Number(url.searchParams.get("minScore") || 0) || 0);
  const minPurchases = Math.max(0, Number(url.searchParams.get("minPurchases") || 0) || 0);
  const minStreak = Math.max(0, Number(url.searchParams.get("minStreak") || 0) || 0);
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
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const sort = parseSortKey(url.searchParams.get("sort"));
  const sortDir =
    url.searchParams.get("sortDir") === "asc" || url.searchParams.get("sortDir") === "desc"
      ? (url.searchParams.get("sortDir") as "asc" | "desc")
      : "desc";

  const filtered = filterPoliticianRepeatBuyerRows(cache.rows, {
    minScore,
    minPurchases,
    minStreak,
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
  });
  const sorted = sortPoliticianRepeatBuyerRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    fetchedAt: cache.fetchedAt,
    available: true,
    unavailableReason: null,
    summary: summarizePoliticianRepeatBuyers(sorted),
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
  };
}

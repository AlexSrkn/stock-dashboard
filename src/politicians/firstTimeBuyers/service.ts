import { DEFAULT_MIN_YEARS_SINCE_LAST_BUY } from "./config.js";
import { computePoliticianFirstTimeBuyers } from "./compute.js";
import { parseDateMs, round2 } from "./dates.js";
import type {
  MarketCapBucket,
  PoliticianFirstTimeBuyerRow,
  PoliticianFirstTimeBuyersCachePayload,
  PoliticianFirstTimeBuyersPayload,
  PoliticianFirstTimeBuyersSummary,
  PoliticianFirstTimeBuyerSortKey,
} from "./types.js";

let memoryCache: {
  loadedAt: number;
  minYears: number;
  payload: PoliticianFirstTimeBuyersCachePayload;
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

function parseSortKey(raw: string | null): PoliticianFirstTimeBuyerSortKey {
  const allowed: PoliticianFirstTimeBuyerSortKey[] = [
    "transactionDate",
    "yearsSinceLastBuy",
    "estimatedPurchaseValue",
    "politicianName",
    "ticker",
    "party",
    "state",
    "previousBuyDate",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as PoliticianFirstTimeBuyerSortKey;
  return "transactionDate";
}

export function filterPoliticianFirstTimeBuyerRows(
  rows: PoliticianFirstTimeBuyerRow[],
  options: {
    minYears?: number;
    firstRecordedOnly?: boolean;
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
): PoliticianFirstTimeBuyerRow[] {
  const minYears = Number(options.minYears) || 0;
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
    if (options.firstRecordedOnly && !row.firstRecordedPurchase) return false;
    if (
      minYears > 0 &&
      !row.firstRecordedPurchase &&
      (row.yearsSinceLastBuy == null || row.yearsSinceLastBuy < minYears)
    ) {
      return false;
    }
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

    const txMs = parseDateMs(row.transactionDate);
    if (Number.isFinite(fromMs) && Number.isFinite(txMs) && txMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(txMs) && txMs > toMs + 86_400_000 - 1) {
      return false;
    }

    if (!q) return true;
    const hay = `${row.ticker} ${row.companyName || ""} ${row.politicianName}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortPoliticianFirstTimeBuyerRows(
  rows: PoliticianFirstTimeBuyerRow[],
  sortKey: PoliticianFirstTimeBuyerSortKey,
  sortDir: "asc" | "desc"
): PoliticianFirstTimeBuyerRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "ticker") {
      return a.ticker.localeCompare(b.ticker) * dir;
    }
    if (sortKey === "politicianName" || sortKey === "party" || sortKey === "state") {
      const av = String(a[sortKey] || "");
      const bv = String(b[sortKey] || "");
      return av.localeCompare(bv) * dir || a.ticker.localeCompare(b.ticker);
    }
    if (sortKey === "transactionDate" || sortKey === "previousBuyDate") {
      const av = parseDateMs(a[sortKey]) || 0;
      const bv = parseDateMs(b[sortKey]) || 0;
      return (av - bv) * dir || a.ticker.localeCompare(b.ticker);
    }
    if (sortKey === "yearsSinceLastBuy") {
      const ax = a.firstRecordedPurchase ? -1 : Number(a.yearsSinceLastBuy);
      const bx = b.firstRecordedPurchase ? -1 : Number(b.yearsSinceLastBuy);
      const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
    }
    const ax = Number(a[sortKey]);
    const bx = Number(b[sortKey]);
    const an = Number.isFinite(ax) ? ax : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bx) ? bx : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir || a.ticker.localeCompare(b.ticker);
  });
}

export function summarizePoliticianFirstTimeBuyers(
  rows: PoliticianFirstTimeBuyerRow[]
): PoliticianFirstTimeBuyersSummary {
  if (!rows.length) {
    return {
      firstRecordedBuyers: 0,
      returningBuyers: 0,
      averageYearsSincePreviousPurchase: null,
      totalEstimatedPurchases: 0,
    };
  }

  let firstRecorded = 0;
  let returning = 0;
  let yearsSum = 0;
  let yearsCount = 0;
  let totalValue = 0;

  for (const row of rows) {
    if (row.firstRecordedPurchase) firstRecorded += 1;
    else {
      returning += 1;
      if (row.yearsSinceLastBuy != null && Number.isFinite(row.yearsSinceLastBuy)) {
        yearsSum += row.yearsSinceLastBuy;
        yearsCount += 1;
      }
    }
    totalValue += row.estimatedPurchaseValue;
  }

  return {
    firstRecordedBuyers: firstRecorded,
    returningBuyers: returning,
    averageYearsSincePreviousPurchase:
      yearsCount > 0 ? round2(yearsSum / yearsCount) : null,
    totalEstimatedPurchases: round2(totalValue),
  };
}

export async function loadPoliticianFirstTimeBuyersCache(
  minYears: number = DEFAULT_MIN_YEARS_SINCE_LAST_BUY
): Promise<PoliticianFirstTimeBuyersCachePayload> {
  const now = Date.now();
  if (
    memoryCache &&
    memoryCache.minYears === minYears &&
    now - memoryCache.loadedAt < MEMORY_CACHE_MS
  ) {
    return memoryCache.payload;
  }
  const payload = await computePoliticianFirstTimeBuyers({ minYears });
  memoryCache = { loadedAt: now, minYears, payload };
  return payload;
}

export function invalidatePoliticianFirstTimeBuyersCache(): void {
  memoryCache = null;
}

export async function getPoliticianFirstTimeBuyers(
  url: URL
): Promise<PoliticianFirstTimeBuyersPayload> {
  const minYearsRaw = Number(url.searchParams.get("minYears"));
  const minYears =
    Number.isFinite(minYearsRaw) && minYearsRaw >= 0
      ? minYearsRaw
      : DEFAULT_MIN_YEARS_SINCE_LAST_BUY;

  const cache = await loadPoliticianFirstTimeBuyersCache(minYears);
  if (!cache.fetchedAt && !cache.rows.length) {
    return {
      computedAt: cache.computedAt,
      fetchedAt: null,
      minYearsThreshold: minYears,
      available: false,
      unavailableReason: "No politician data yet. Run: npm run politicians:fetch-recent",
      summary: {
        firstRecordedBuyers: 0,
        returningBuyers: 0,
        averageYearsSincePreviousPurchase: null,
        totalEstimatedPurchases: 0,
      },
      sectors: [],
      politicians: [],
      states: [],
      parties: [],
      page: 1,
      pageSize: 50,
      total: 0,
      sort: "transactionDate",
      sortDir: "desc",
      rows: [],
    };
  }

  const firstRecordedOnly =
    url.searchParams.get("firstRecordedOnly") === "1" ||
    url.searchParams.get("firstRecordedOnly") === "true";
  const filterMinYears = Math.max(
    0,
    Number(url.searchParams.get("filterMinYears") || url.searchParams.get("minYearsFilter") || 0) ||
      0
  );
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

  const filtered = filterPoliticianFirstTimeBuyerRows(cache.rows, {
    minYears: filterMinYears,
    firstRecordedOnly,
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
  const sorted = sortPoliticianFirstTimeBuyerRows(filtered, sort, sortDir);
  const total = sorted.length;
  const offset = (page - 1) * pageSize;

  return {
    computedAt: cache.computedAt,
    fetchedAt: cache.fetchedAt,
    minYearsThreshold: cache.minYearsThreshold,
    available: true,
    unavailableReason: null,
    summary: summarizePoliticianFirstTimeBuyers(sorted),
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

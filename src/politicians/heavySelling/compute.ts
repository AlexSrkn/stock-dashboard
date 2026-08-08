import { getPool } from "../../db/pool.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "../../institution/mostAccumulated/queries.js";
import {
  politicianKey,
  resolveTicker,
  tradeDate,
  parseTradeDateMs,
} from "../analytics/compute.js";
import { readPoliticiansRecent, type PoliticianFilingBundle } from "../recent.js";
import {
  DEFAULT_MULTIPLE_SELLERS_MIN,
  DEFAULT_MULTIPLE_SELLERS_WINDOW_DAYS,
} from "./config.js";
import { detectMultiplePoliticianSellers, saleStreaks } from "./detect.js";
import { estimatedValue, round2, toIsoDate } from "./dates.js";
import type {
  PoliticianHeavySellingCachePayload,
  PoliticianHeavySellingRow,
  PoliticianHeavySellingSeller,
  PoliticianLargestSaleRow,
} from "./types.js";

const MS_DAY = 86_400_000;
const MS_30 = 30 * MS_DAY;
const MS_90 = 90 * MS_DAY;
const MS_12M = 365 * MS_DAY;

function isValidTicker(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(ticker);
}

interface FlatEvent {
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  state: string | null;
  party: string | null;
  ticker: string;
  assetName: string | null;
  category: "buy" | "sell";
  dateMs: number;
  dateIso: string | null;
  estimatedValue: number;
}

async function loadStockEnrichment(
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  if (!tickers.length) return out;
  try {
    const pool = getPool();
    const res = await pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
    }>(SELECT_STOCK_ENRICHMENT_SQL, [tickers]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        companyName: row.company_name ? String(row.company_name) : null,
        sector: row.sector ? String(row.sector) : null,
      });
    }
  } catch {
    /* optional */
  }
  return out;
}

function flattenEvents(bundles: PoliticianFilingBundle[]): FlatEvent[] {
  const rows: FlatEvent[] = [];
  for (const bundle of bundles) {
    const key = bundle.politicianKey || politicianKey(bundle.politicianName);
    const party = bundle.party ?? null;
    for (const trade of bundle.trades || []) {
      const ticker = resolveTicker(trade);
      if (!ticker || !isValidTicker(ticker)) continue;
      const category =
        trade.transactionCategory === "buy"
          ? "buy"
          : trade.transactionCategory === "sell"
            ? "sell"
            : null;
      if (!category) continue;
      const when = parseTradeDateMs(tradeDate(trade));
      rows.push({
        politicianKey: key,
        politicianName: bundle.politicianName,
        chamber: bundle.chamber,
        state: trade.state
          ? String(trade.state).toUpperCase()
          : bundle.state
            ? String(bundle.state).toUpperCase()
            : null,
        party: trade.party ?? party,
        ticker,
        assetName: trade.assetName ? String(trade.assetName).trim() || null : null,
        category,
        dateMs: when || 0,
        dateIso: when ? toIsoDate(when) : null,
        estimatedValue: estimatedValue(trade.amountMin, trade.amountMax),
      });
    }
  }
  return rows;
}

function pairKey(ticker: string, polKey: string): string {
  return `${ticker}::${polKey}`;
}

function buildSellerStats(events: FlatEvent[]): Map<string, PoliticianHeavySellingSeller> {
  const byPair = new Map<string, FlatEvent[]>();
  for (const e of events) {
    const k = pairKey(e.ticker, e.politicianKey);
    let list = byPair.get(k);
    if (!list) {
      list = [];
      byPair.set(k, list);
    }
    list.push(e);
  }

  const out = new Map<string, PoliticianHeavySellingSeller>();
  for (const [k, list] of byPair) {
    const sorted = [...list].sort((a, b) => a.dateMs - b.dateMs || a.category.localeCompare(b.category));
    const codes = sorted.map((e) => e.category);
    const { current, previous } = saleStreaks(codes);
    const sells = sorted.filter((e) => e.category === "sell");
    if (!sells.length) continue;
    const first = sells[0]!;
    const last = sells[sells.length - 1]!;
    out.set(k, {
      politicianKey: first.politicianKey,
      politicianName: first.politicianName,
      party: first.party,
      state: first.state,
      chamber: first.chamber,
      sellCount: sells.length,
      estimatedSold: round2(sells.reduce((s, e) => s + e.estimatedValue, 0)),
      currentConsecutiveSales: current,
      previousConsecutiveSales: previous,
      firstSellDate: first.dateIso,
      latestSellDate: last.dateIso,
    });
  }
  return out;
}

export async function computePoliticianHeavySelling(opts: {
  windowDays?: number;
  minSellers?: number;
} = {}): Promise<PoliticianHeavySellingCachePayload> {
  const windowDays = opts.windowDays ?? DEFAULT_MULTIPLE_SELLERS_WINDOW_DAYS;
  const minSellers = opts.minSellers ?? DEFAULT_MULTIPLE_SELLERS_MIN;
  const payload = readPoliticiansRecent();
  if (!payload) {
    return {
      version: 1,
      computedAt: new Date().toISOString(),
      fetchedAt: null,
      multipleSellersWindowDays: windowDays,
      multipleSellersMin: minSellers,
      rows: [],
      largestSales: [],
      sectors: [],
      politicians: [],
      states: [],
      parties: [],
    };
  }

  const events = flattenEvents([...payload.house, ...payload.senate]);
  const sells = events.filter((e) => e.category === "sell");
  const sellerStats = buildSellerStats(events);
  const now = Date.now();

  const byTicker = new Map<string, FlatEvent[]>();
  for (const s of sells) {
    let list = byTicker.get(s.ticker);
    if (!list) {
      list = [];
      byTicker.set(s.ticker, list);
    }
    list.push(s);
  }

  const tickers = [...byTicker.keys()];
  const enrichment = await loadStockEnrichment(tickers);
  const rows: PoliticianHeavySellingRow[] = [];
  const largestSales: PoliticianLargestSaleRow[] = [];

  for (const [ticker, list] of byTicker) {
    const stock = enrichment.get(ticker);
    const sellersMap = new Map<string, PoliticianHeavySellingSeller>();
    for (const s of list) {
      const stats = sellerStats.get(pairKey(ticker, s.politicianKey));
      if (stats) sellersMap.set(s.politicianKey, stats);
    }
    const sellers = [...sellersMap.values()];

    let estimatedTotal = 0;
    let largestSale = 0;
    let salesLast30Days = 0;
    let salesLast90Days = 0;
    let salesLast12Months = 0;
    let firstMs = Number.POSITIVE_INFINITY;
    let latestMs = 0;
    let assetName: string | null = null;

    for (const s of list) {
      estimatedTotal += s.estimatedValue;
      if (s.estimatedValue > largestSale) largestSale = s.estimatedValue;
      if (s.dateMs >= now - MS_30) salesLast30Days += 1;
      if (s.dateMs >= now - MS_90) salesLast90Days += 1;
      if (s.dateMs >= now - MS_12M) salesLast12Months += 1;
      if (s.dateMs > 0 && s.dateMs < firstMs) firstMs = s.dateMs;
      if (s.dateMs > latestMs) latestMs = s.dateMs;
      if (s.assetName && !assetName) assetName = s.assetName;

      largestSales.push({
        ticker,
        companyName: stock?.companyName || assetName,
        politicianKey: s.politicianKey,
        politicianName: s.politicianName,
        party: s.party,
        state: s.state,
        chamber: s.chamber,
        transactionDate: s.dateIso,
        estimatedSaleValue: round2(s.estimatedValue),
      });
    }

    const multi = detectMultiplePoliticianSellers(
      list.map((s) => ({
        politicianKey: s.politicianKey,
        dateMs: s.dateMs,
        estimatedValue: s.estimatedValue,
        party: s.party,
        chamber: s.chamber,
      })),
      windowDays,
      minSellers
    );

    let democratSellers = 0;
    let republicanSellers = 0;
    let independentSellers = 0;
    let senatorSellers = 0;
    let representativeSellers = 0;
    let maxCurrentStreak = 0;
    let maxPreviousStreak = 0;
    for (const seller of sellers) {
      const party = String(seller.party || "").toLowerCase();
      if (party.includes("democrat")) democratSellers += 1;
      else if (party.includes("republican")) republicanSellers += 1;
      else if (seller.party) independentSellers += 1;
      if (seller.chamber === "senate") senatorSellers += 1;
      else representativeSellers += 1;
      if (seller.currentConsecutiveSales > maxCurrentStreak) {
        maxCurrentStreak = seller.currentConsecutiveSales;
      }
      if (seller.previousConsecutiveSales > maxPreviousStreak) {
        maxPreviousStreak = seller.previousConsecutiveSales;
      }
    }

    const sellTransactions = list.length;
    rows.push({
      ticker,
      companyName: stock?.companyName || assetName,
      sector: stock?.sector || null,
      marketCapUsd: null,
      sellTransactions,
      uniqueSellers: sellers.length,
      estimatedTotalSold: round2(estimatedTotal),
      largestSale: round2(largestSale),
      averageSale: sellTransactions > 0 ? round2(estimatedTotal / sellTransactions) : 0,
      currentConsecutiveSales: maxCurrentStreak,
      previousConsecutiveSales: maxPreviousStreak,
      multipleSellers: multi.multipleSellers,
      multipleSellerCount: multi.peakUniqueSellers,
      democratSellers,
      republicanSellers,
      independentSellers,
      senatorSellers,
      representativeSellers,
      salesLast30Days,
      salesLast90Days,
      salesLast12Months,
      firstSale: Number.isFinite(firstMs) ? toIsoDate(firstMs) : null,
      latestSale: latestMs > 0 ? toIsoDate(latestMs) : null,
      sellers,
    });
  }

  rows.sort(
    (a, b) =>
      b.estimatedTotalSold - a.estimatedTotalSold ||
      b.uniqueSellers - a.uniqueSellers ||
      a.ticker.localeCompare(b.ticker)
  );

  largestSales.sort(
    (a, b) =>
      b.estimatedSaleValue - a.estimatedSaleValue ||
      a.ticker.localeCompare(b.ticker)
  );

  const sectors = [
    ...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s))),
  ].sort();
  const politicianMap = new Map<string, string>();
  const states = new Set<string>();
  const parties = new Set<string>();
  for (const row of rows) {
    for (const s of row.sellers) {
      politicianMap.set(s.politicianKey, s.politicianName);
      if (s.state) states.add(s.state);
      if (s.party) parties.add(s.party);
    }
  }

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    fetchedAt: payload.fetchedAt,
    multipleSellersWindowDays: windowDays,
    multipleSellersMin: minSellers,
    rows,
    largestSales: largestSales.slice(0, 100),
    sectors,
    politicians: [...politicianMap.entries()]
      .map(([politicianKey, politicianName]) => ({ politicianKey, politicianName }))
      .sort((a, b) => a.politicianName.localeCompare(b.politicianName)),
    states: [...states].sort(),
    parties: [...parties].sort(),
  };
}

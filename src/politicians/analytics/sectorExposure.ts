import { getPool } from "../../db/pool.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "../../institution/mostAccumulated/queries.js";
import { readPoliticiansRecent } from "../recent.js";
import {
  amountMid,
  flattenTrades,
  parseTradeDateMs,
  periodDays,
  periodLabel,
  politicianKey,
  resolveTicker,
  tradeDate,
} from "./compute.js";
import type {
  PoliticianAnalyticsPeriod,
  PoliticianChamberFilter,
  PoliticianProfileSectorPayload,
  PoliticianSectorDetailPayload,
  PoliticianSectorExposureFilters,
  PoliticianSectorExposurePayload,
  PoliticianSectorMonthlyRow,
  PoliticianSectorRow,
  PoliticianSectorTradeRow,
  PoliticianTransactionTypeFilter,
} from "./types.js";
import type { PoliticianTrade } from "../types.js";

const UNKNOWN_SECTOR = "Unknown";

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sectorSlug(sector: string): string {
  return String(sector || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sectorFromSlug(slug: string, sectors: string[]): string | null {
  const normalized = String(slug || "").toLowerCase();
  return sectors.find((s) => sectorSlug(s) === normalized) ?? null;
}

export function parsePoliticianTransactionTypeFilter(
  raw: string | null
): PoliticianTransactionTypeFilter {
  if (raw === "buy" || raw === "sell" || raw === "exchange") return raw;
  return "all";
}

export function parseSectorExposureFilters(url: URL): PoliticianSectorExposureFilters {
  const period = url.searchParams.get("period");
  return {
    period:
      period === "30d" || period === "year" || period === "quarter"
        ? period
        : "quarter",
    dateFrom: url.searchParams.get("dateFrom") || null,
    dateTo: url.searchParams.get("dateTo") || null,
    chamber:
      url.searchParams.get("chamber") === "house" || url.searchParams.get("chamber") === "senate"
        ? url.searchParams.get("chamber")
        : "all",
    politicianKey: url.searchParams.get("politician") || null,
    state: url.searchParams.get("state")?.toUpperCase() || null,
    transactionType: parsePoliticianTransactionTypeFilter(url.searchParams.get("transactionType")),
    sector: url.searchParams.get("sector") || null,
    search: url.searchParams.get("search") || null,
  };
}

interface EnrichedTrade {
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  state: string | null;
  ticker: string | null;
  companyName: string | null;
  sector: string;
  transactionCategory: PoliticianTrade["transactionCategory"];
  transactionType: string;
  transactionDate: string | null;
  filingDate: string | null;
  amountUsd: number;
  amountRange: string | null;
}

function inDateWindow(
  trade: PoliticianTrade,
  filters: PoliticianSectorExposureFilters
): boolean {
  const when = parseTradeDateMs(tradeDate(trade));
  if (filters.dateFrom) {
    const from = parseTradeDateMs(filters.dateFrom);
    if (from && when < from) return false;
  }
  if (filters.dateTo) {
    const to = parseTradeDateMs(filters.dateTo);
    if (to && when > to) return false;
  }
  if (!filters.dateFrom && !filters.dateTo) {
    const days = periodDays(filters.period);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    if (when && when < cutoff) return false;
    if (!when && filters.period !== "year") return false;
  }
  return true;
}

function matchesFilters(trade: EnrichedTrade, filters: PoliticianSectorExposureFilters): boolean {
  if (filters.chamber !== "all" && trade.chamber !== filters.chamber) return false;
  if (filters.politicianKey && trade.politicianKey !== filters.politicianKey) return false;
  if (filters.state && String(trade.state || "").toUpperCase() !== filters.state) return false;
  if (filters.transactionType !== "all" && trade.transactionCategory !== filters.transactionType) {
    return false;
  }
  if (filters.sector && trade.sector !== filters.sector) return false;
  const q = filters.search?.trim().toLowerCase();
  if (q) {
    const politician = trade.politicianName.toLowerCase();
    const ticker = String(trade.ticker || "").toLowerCase();
    const company = String(trade.companyName || "").toLowerCase();
    if (!politician.includes(q) && !ticker.includes(q) && !company.includes(q)) return false;
  }
  return true;
}

async function loadStockSectors(tickers: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!tickers.length) return out;
  try {
    const pool = getPool();
    const res = await pool.query<{ ticker: string; sector: string | null }>(
      SELECT_STOCK_ENRICHMENT_SQL,
      [tickers]
    );
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), row.sector ? String(row.sector) : null);
    }
  } catch {
    /* sector enrichment optional when database unavailable */
  }
  return out;
}

async function loadEnrichedTrades(
  filters: PoliticianSectorExposureFilters
): Promise<{
  fetchedAt: string | null;
  trades: EnrichedTrade[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
}> {
  const payload = readPoliticiansRecent();
  if (!payload) {
    return { fetchedAt: null, trades: [], politicians: [], states: [] };
  }

  const periodForFlatten =
    filters.dateFrom || filters.dateTo ? "year" : filters.period;
  const flat = flattenTrades([...payload.house, ...payload.senate], "all", periodForFlatten);
  const filteredFlat = flat.filter((trade) => inDateWindow(trade, filters));
  const tickers = [
    ...new Set(filteredFlat.map((t) => resolveTicker(t)).filter(Boolean)),
  ] as string[];
  const sectorsByTicker = await loadStockSectors(tickers);

  const politicianMap = new Map<string, string>();
  const states = new Set<string>();
  const trades: EnrichedTrade[] = [];

  for (const trade of filteredFlat) {
    const ticker = resolveTicker(trade) || null;
    const sector = ticker ? sectorsByTicker.get(ticker) || UNKNOWN_SECTOR : UNKNOWN_SECTOR;
    const companyName = trade.assetName ? String(trade.assetName) : null;
    const amountUsd = amountMid(trade);
    if (amountUsd <= 0) continue;

    politicianMap.set(trade.politicianKey, trade.politicianName);
    if (trade.state) states.add(String(trade.state).toUpperCase());

    const enriched: EnrichedTrade = {
      politicianKey: trade.politicianKey,
      politicianName: trade.politicianName,
      chamber: trade.chamber,
      state: trade.state ? String(trade.state).toUpperCase() : null,
      ticker,
      companyName,
      sector,
      transactionCategory: trade.transactionCategory,
      transactionType: trade.transactionType,
      transactionDate: trade.transactionDate || trade.notificationDate || trade.filingDate,
      filingDate: trade.filingDate,
      amountUsd: roundUsd(amountUsd),
      amountRange: trade.amountRange,
    };
    if (!matchesFilters(enriched, filters)) continue;
    trades.push(enriched);
  }

  return {
    fetchedAt: payload.fetchedAt,
    trades,
    politicians: [...politicianMap.entries()]
      .map(([politicianKey, politicianName]) => ({ politicianKey, politicianName }))
      .sort((a, b) => a.politicianName.localeCompare(b.politicianName)),
    states: [...states].sort(),
  };
}

function monthKey(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const iso = String(dateStr).match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const us = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${String(us[1]).padStart(2, "0")}`;
  return null;
}

function buildMonthlyActivity(trades: EnrichedTrade[]): PoliticianSectorMonthlyRow[] {
  const byMonth = new Map<string, PoliticianSectorMonthlyRow>();
  for (const trade of trades) {
    const month = monthKey(trade.transactionDate);
    if (!month) continue;
    let row = byMonth.get(month);
    if (!row) {
      row = { month, tradeCount: 0, buyCount: 0, sellCount: 0, sectors: [] };
      byMonth.set(month, row);
    }
    row.tradeCount += 1;
    if (trade.transactionCategory === "buy") row.buyCount += 1;
    if (trade.transactionCategory === "sell") row.sellCount += 1;
    let sectorRow = row.sectors.find((s) => s.sector === trade.sector);
    if (!sectorRow) {
      sectorRow = { sector: trade.sector, tradeCount: 0 };
      row.sectors.push(sectorRow);
    }
    sectorRow.tradeCount += 1;
  }
  return [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      ...row,
      sectors: row.sectors.sort((a, b) => b.tradeCount - a.tradeCount),
    }));
}

function toTradeRow(trade: EnrichedTrade): PoliticianSectorTradeRow {
  return {
    politicianKey: trade.politicianKey,
    politicianName: trade.politicianName,
    chamber: trade.chamber,
    state: trade.state,
    ticker: trade.ticker,
    companyName: trade.companyName,
    transactionCategory: trade.transactionCategory,
    transactionType: trade.transactionType,
    transactionDate: trade.transactionDate,
    amountUsd: trade.amountUsd,
    amountRange: trade.amountRange,
    filingDate: trade.filingDate,
  };
}

function aggregateSectorRows(trades: EnrichedTrade[]): PoliticianSectorRow[] {
  const bySector = new Map<
    string,
    {
      tradeCount: number;
      politicians: Set<string>;
      totalEstimatedValueUsd: number;
      buyCount: number;
      sellCount: number;
      exchangeCount: number;
      stockCounts: Map<string, { ticker: string; companyName: string | null; tradeCount: number }>;
      buyerTotals: Map<string, { politicianKey: string; politicianName: string; buyValueUsd: number }>;
    }
  >();

  for (const trade of trades) {
    let bucket = bySector.get(trade.sector);
    if (!bucket) {
      bucket = {
        tradeCount: 0,
        politicians: new Set(),
        totalEstimatedValueUsd: 0,
        buyCount: 0,
        sellCount: 0,
        exchangeCount: 0,
        stockCounts: new Map(),
        buyerTotals: new Map(),
      };
      bySector.set(trade.sector, bucket);
    }
    bucket.tradeCount += 1;
    bucket.politicians.add(trade.politicianKey);
    bucket.totalEstimatedValueUsd = roundUsd(bucket.totalEstimatedValueUsd + trade.amountUsd);
    if (trade.transactionCategory === "buy") bucket.buyCount += 1;
    else if (trade.transactionCategory === "sell") bucket.sellCount += 1;
    else if (trade.transactionCategory === "exchange") bucket.exchangeCount += 1;

    if (trade.ticker) {
      const key = trade.ticker;
      let stock = bucket.stockCounts.get(key);
      if (!stock) {
        stock = { ticker: trade.ticker, companyName: trade.companyName, tradeCount: 0 };
        bucket.stockCounts.set(key, stock);
      }
      stock.tradeCount += 1;
    }

    if (trade.transactionCategory === "buy") {
      let buyer = bucket.buyerTotals.get(trade.politicianKey);
      if (!buyer) {
        buyer = {
          politicianKey: trade.politicianKey,
          politicianName: trade.politicianName,
          buyValueUsd: 0,
        };
        bucket.buyerTotals.set(trade.politicianKey, buyer);
      }
      buyer.buyValueUsd = roundUsd(buyer.buyValueUsd + trade.amountUsd);
    }
  }

  return [...bySector.entries()]
    .map(([sector, bucket]) => {
      const mostTradedStock =
        [...bucket.stockCounts.values()].sort((a, b) => b.tradeCount - a.tradeCount)[0] ?? null;
      const largestBuyer =
        [...bucket.buyerTotals.values()].sort((a, b) => b.buyValueUsd - a.buyValueUsd)[0] ?? null;
      return {
        sector,
        sectorSlug: sectorSlug(sector),
        tradeCount: bucket.tradeCount,
        politicianCount: bucket.politicians.size,
        totalEstimatedValueUsd: bucket.totalEstimatedValueUsd,
        buyCount: bucket.buyCount,
        sellCount: bucket.sellCount,
        exchangeCount: bucket.exchangeCount,
        netBuyCount: bucket.buyCount - bucket.sellCount,
        mostTradedStock,
        largestBuyer,
      };
    })
    .sort((a, b) => b.tradeCount - a.tradeCount);
}

export async function computePoliticianSectorExposure(
  filters: PoliticianSectorExposureFilters
): Promise<PoliticianSectorExposurePayload> {
  const base = {
    period: filters.period,
    periodLabel: periodLabel(filters.period),
    chamber: filters.chamber,
    filters,
  };

  const { fetchedAt, trades, politicians, states } = await loadEnrichedTrades(filters);
  if (!fetchedAt) {
    return {
      ...base,
      available: false,
      unavailableReason: "No politician data yet. Run: npm run politicians:fetch-recent",
      fetchedAt: null,
      summary: {
        totalTrades: 0,
        totalPoliticians: 0,
        sectorCount: 0,
        mostTradedSector: null,
      },
      sectors: [],
      politicians: [],
      states: [],
      rows: [],
      charts: { sectorAllocation: [], buyVsSell: [], monthlyActivity: [] },
    };
  }

  if (!trades.length) {
    return {
      ...base,
      available: false,
      unavailableReason: "No congressional trades match the current filters.",
      fetchedAt,
      summary: {
        totalTrades: 0,
        totalPoliticians: 0,
        sectorCount: 0,
        mostTradedSector: null,
      },
      sectors: [],
      politicians,
      states,
      rows: [],
      charts: { sectorAllocation: [], buyVsSell: [], monthlyActivity: [] },
    };
  }

  const rows = aggregateSectorRows(trades);
  const sectorNames = rows.map((r) => r.sector);
  const politicianIds = new Set(trades.map((t) => t.politicianKey));
  const topSector = rows[0]?.sector ?? null;

  const chartRows = rows.map((r) => ({
    sector: r.sector,
    tradeCount: r.tradeCount,
    buyCount: r.buyCount,
    sellCount: r.sellCount,
  }));

  return {
    ...base,
    available: true,
    unavailableReason: null,
    fetchedAt,
    summary: {
      totalTrades: trades.length,
      totalPoliticians: politicianIds.size,
      sectorCount: rows.length,
      mostTradedSector: topSector,
    },
    sectors: sectorNames,
    politicians,
    states,
    rows,
    charts: {
      sectorAllocation: chartRows,
      buyVsSell: chartRows,
      monthlyActivity: buildMonthlyActivity(trades),
    },
  };
}

export async function computePoliticianSectorDetail(
  sectorName: string,
  filters: PoliticianSectorExposureFilters
): Promise<PoliticianSectorDetailPayload> {
  const scopedFilters = { ...filters, sector: sectorName };
  const { fetchedAt, trades } = await loadEnrichedTrades(scopedFilters);
  const sector = sectorName;
  const sectorSlugValue = sectorSlug(sector);

  if (!fetchedAt || !trades.length) {
    return {
      sector,
      sectorSlug: sectorSlugValue,
      available: false,
      unavailableReason: fetchedAt
        ? "No trades found for this sector and filter set."
        : "No politician data yet. Run: npm run politicians:fetch-recent",
      fetchedAt,
      filters: scopedFilters,
      summary: {
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        politicianCount: 0,
        totalEstimatedValueUsd: 0,
      },
      politicians: [],
      mostTradedStocks: [],
      largestPurchases: [],
      largestSales: [],
      monthlyActivity: [],
      recentDisclosures: [],
    };
  }

  const byPolitician = new Map<
    string,
    {
      politicianKey: string;
      politicianName: string;
      chamber: "house" | "senate";
      state: string | null;
      tradeCount: number;
      buyCount: number;
      sellCount: number;
      buyUsd: number;
      sellUsd: number;
    }
  >();
  const byStock = new Map<
    string,
    { ticker: string; companyName: string | null; tradeCount: number; totalValueUsd: number }
  >();

  for (const trade of trades) {
    let pol = byPolitician.get(trade.politicianKey);
    if (!pol) {
      pol = {
        politicianKey: trade.politicianKey,
        politicianName: trade.politicianName,
        chamber: trade.chamber,
        state: trade.state,
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        buyUsd: 0,
        sellUsd: 0,
      };
      byPolitician.set(trade.politicianKey, pol);
    }
    pol.tradeCount += 1;
    if (trade.transactionCategory === "buy") {
      pol.buyCount += 1;
      pol.buyUsd = roundUsd(pol.buyUsd + trade.amountUsd);
    } else if (trade.transactionCategory === "sell") {
      pol.sellCount += 1;
      pol.sellUsd = roundUsd(pol.sellUsd + trade.amountUsd);
    }

    if (trade.ticker) {
      let stock = byStock.get(trade.ticker);
      if (!stock) {
        stock = {
          ticker: trade.ticker,
          companyName: trade.companyName,
          tradeCount: 0,
          totalValueUsd: 0,
        };
        byStock.set(trade.ticker, stock);
      }
      stock.tradeCount += 1;
      stock.totalValueUsd = roundUsd(stock.totalValueUsd + trade.amountUsd);
    }
  }

  const purchases = trades
    .filter((t) => t.transactionCategory === "buy")
    .sort((a, b) => b.amountUsd - a.amountUsd)
    .slice(0, 25)
    .map(toTradeRow);
  const sales = trades
    .filter((t) => t.transactionCategory === "sell")
    .sort((a, b) => b.amountUsd - a.amountUsd)
    .slice(0, 25)
    .map(toTradeRow);
  const recentDisclosures = [...trades]
    .sort((a, b) => parseTradeDateMs(b.transactionDate) - parseTradeDateMs(a.transactionDate))
    .slice(0, 25)
    .map(toTradeRow);

  return {
    sector,
    sectorSlug: sectorSlugValue,
    available: true,
    unavailableReason: null,
    fetchedAt,
    filters: scopedFilters,
    summary: {
      tradeCount: trades.length,
      buyCount: trades.filter((t) => t.transactionCategory === "buy").length,
      sellCount: trades.filter((t) => t.transactionCategory === "sell").length,
      politicianCount: byPolitician.size,
      totalEstimatedValueUsd: roundUsd(trades.reduce((sum, t) => sum + t.amountUsd, 0)),
    },
    politicians: [...byPolitician.values()]
      .map((p) => ({
        politicianKey: p.politicianKey,
        politicianName: p.politicianName,
        chamber: p.chamber,
        state: p.state,
        tradeCount: p.tradeCount,
        buyCount: p.buyCount,
        sellCount: p.sellCount,
        netAmountUsd: roundUsd(p.buyUsd - p.sellUsd),
      }))
      .sort((a, b) => b.tradeCount - a.tradeCount),
    mostTradedStocks: [...byStock.values()].sort((a, b) => b.tradeCount - a.tradeCount).slice(0, 15),
    largestPurchases: purchases,
    largestSales: sales,
    monthlyActivity: buildMonthlyActivity(trades),
    recentDisclosures,
  };
}

export async function computePoliticianProfileSectorExposure(
  key: string,
  period: PoliticianAnalyticsPeriod = "quarter",
  chamber: PoliticianChamberFilter = "all"
): Promise<PoliticianProfileSectorPayload> {
  const filters: PoliticianSectorExposureFilters = {
    period,
    dateFrom: null,
    dateTo: null,
    chamber,
    politicianKey: key,
    state: null,
    transactionType: "all",
    sector: null,
    search: null,
  };
  const { fetchedAt, trades } = await loadEnrichedTrades(filters);
  const politicianName = trades[0]?.politicianName || key;

  if (!fetchedAt || !trades.length) {
    return {
      politicianKey: key,
      politicianName,
      available: false,
      unavailableReason: fetchedAt
        ? "No trades found for this politician in the selected period."
        : "No politician data yet. Run: npm run politicians:fetch-recent",
      fetchedAt,
      period,
      periodLabel: periodLabel(period),
      sectorAllocation: [],
      mostTradedSectors: [],
      buyVsSell: {
        buyCount: 0,
        sellCount: 0,
        exchangeCount: 0,
        buyValueUsd: 0,
        sellValueUsd: 0,
      },
      monthlySectorActivity: [],
    };
  }

  const bySector = new Map<
    string,
    { totalValueUsd: number; tradeCount: number; buyCount: number; sellCount: number }
  >();
  let buyCount = 0;
  let sellCount = 0;
  let exchangeCount = 0;
  let buyValueUsd = 0;
  let sellValueUsd = 0;

  for (const trade of trades) {
    let row = bySector.get(trade.sector);
    if (!row) {
      row = { totalValueUsd: 0, tradeCount: 0, buyCount: 0, sellCount: 0 };
      bySector.set(trade.sector, row);
    }
    row.tradeCount += 1;
    row.totalValueUsd = roundUsd(row.totalValueUsd + trade.amountUsd);
    if (trade.transactionCategory === "buy") {
      row.buyCount += 1;
      buyCount += 1;
      buyValueUsd = roundUsd(buyValueUsd + trade.amountUsd);
    } else if (trade.transactionCategory === "sell") {
      row.sellCount += 1;
      sellCount += 1;
      sellValueUsd = roundUsd(sellValueUsd + trade.amountUsd);
    } else if (trade.transactionCategory === "exchange") {
      exchangeCount += 1;
    }
  }

  const totalValue = [...bySector.values()].reduce((sum, r) => sum + r.totalValueUsd, 0);
  const sectorAllocation = [...bySector.entries()]
    .map(([sector, row]) => ({
      sector,
      totalValueUsd: row.totalValueUsd,
      tradeCount: row.tradeCount,
      buyCount: row.buyCount,
      sellCount: row.sellCount,
      weightPct: totalValue > 0 ? roundPct((row.totalValueUsd / totalValue) * 100) : 0,
    }))
    .sort((a, b) => b.totalValueUsd - a.totalValueUsd);

  return {
    politicianKey: key,
    politicianName,
    available: true,
    unavailableReason: null,
    fetchedAt,
    period,
    periodLabel: periodLabel(period),
    sectorAllocation,
    mostTradedSectors: sectorAllocation.slice(0, 5),
    buyVsSell: { buyCount, sellCount, exchangeCount, buyValueUsd, sellValueUsd },
    monthlySectorActivity: buildMonthlyActivity(trades),
  };
}

export function resolvePoliticianKeyFromName(name: string): string {
  return politicianKey(name);
}

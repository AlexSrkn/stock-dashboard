import { politicianKey } from "../politicianKey.js";
import { normalizeTicker } from "../byTicker.js";
import { readPoliticiansRecent, type PoliticianFilingBundle } from "../recent.js";
import type { PoliticianTrade } from "../types.js";
import type {
  PoliticianAnalyticsPeriod,
  PoliticianChamberFilter,
  PoliticianLargestPortfoliosPayload,
  PoliticianMostAccumulatedPayload,
  PoliticianMostAccumulatedRow,
  PoliticianPortfolioRow,
} from "./types.js";

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

function amountMid(trade: PoliticianTrade): number {
  const min = Number(trade.amountMin);
  const max = Number(trade.amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) return (min + max) / 2;
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

function tradeDate(trade: PoliticianTrade): string | null {
  return trade.transactionDate || trade.notificationDate || trade.filingDate || null;
}

function parseTradeDateMs(value: string | null): number {
  if (!value) return 0;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function periodLabel(period: PoliticianAnalyticsPeriod): string {
  if (period === "30d") return "Last 30 days";
  if (period === "year") return "Last year";
  return "Last quarter";
}

export function periodDays(period: PoliticianAnalyticsPeriod): number {
  if (period === "30d") return 30;
  if (period === "year") return 365;
  return 90;
}

function resolveTicker(trade: PoliticianTrade): string {
  const ticker = normalizeTicker(trade.ticker || "");
  if (ticker) return ticker;
  const m = trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
  return m ? normalizeTicker(m[1]) : "";
}

function assetLabelFromTrade(trade: PoliticianTrade): string | null {
  const name = String(trade.assetName || "").trim();
  return name || null;
}

interface FlatTrade extends PoliticianTrade {
  politicianName: string;
  politicianKey: string;
}

function flattenTrades(
  bundles: PoliticianFilingBundle[],
  chamber: PoliticianChamberFilter,
  period: PoliticianAnalyticsPeriod
): FlatTrade[] {
  const days = periodDays(period);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows: FlatTrade[] = [];

  for (const bundle of bundles) {
    if (chamber !== "all" && bundle.chamber !== chamber) continue;
    for (const trade of bundle.trades || []) {
      const when = parseTradeDateMs(tradeDate(trade));
      if (when && when < cutoff) continue;
      if (!when && period !== "year") continue;
      rows.push({
        ...trade,
        chamber: bundle.chamber,
        politicianName: bundle.politicianName,
        politicianKey: bundle.politicianKey || politicianKey(bundle.politicianName),
      });
    }
  }
  return rows;
}

function computePriorTop10Tickers(
  bundles: PoliticianFilingBundle[],
  chamber: PoliticianChamberFilter,
  period: PoliticianAnalyticsPeriod
): Set<string> {
  const shiftedPeriod: PoliticianAnalyticsPeriod = period;
  const days = periodDays(shiftedPeriod);
  const windowMs = days * 24 * 60 * 60 * 1000;
  const end = Date.now() - windowMs;
  const start = end - windowMs;
  const byTicker = new Map<string, number>();

  for (const bundle of bundles) {
    if (chamber !== "all" && bundle.chamber !== chamber) continue;
    for (const trade of bundle.trades || []) {
      const when = parseTradeDateMs(tradeDate(trade));
      if (!when || when < start || when >= end) continue;
      const ticker = resolveTicker(trade);
      if (!ticker) continue;
      const amt = amountMid(trade);
      const delta =
        trade.transactionCategory === "buy" ? amt : trade.transactionCategory === "sell" ? -amt : 0;
      byTicker.set(ticker, roundUsd((byTicker.get(ticker) ?? 0) + delta));
    }
  }

  return new Set(
    [...byTicker.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ticker]) => ticker)
  );
}

export function computePoliticianMostAccumulated(
  period: PoliticianAnalyticsPeriod = "quarter",
  chamber: PoliticianChamberFilter = "all"
): PoliticianMostAccumulatedPayload {
  const payload = readPoliticiansRecent();
  if (!payload) {
    return {
      period,
      periodLabel: periodLabel(period),
      chamber,
      available: false,
      unavailableReason: "No politician data yet. Run: npm run politicians:fetch-recent",
      fetchedAt: null,
      summary: {
        topStock: null,
        totalPoliticiansBuying: 0,
        totalNetAmountUsd: 0,
        averagePercentIncrease: null,
      },
      stocks: [],
    };
  }

  const bundles = [...payload.house, ...payload.senate];
  const trades = flattenTrades(bundles, chamber, period);
  if (!trades.length) {
    return {
      period,
      periodLabel: periodLabel(period),
      chamber,
      available: false,
      unavailableReason: `No congressional trades in the ${periodLabel(period).toLowerCase()} window.`,
      fetchedAt: payload.fetchedAt,
      summary: {
        topStock: null,
        totalPoliticiansBuying: 0,
        totalNetAmountUsd: 0,
        averagePercentIncrease: null,
      },
      stocks: [],
    };
  }

  const byTickerPolitician = new Map<
    string,
    Map<string, { buy: number; sell: number; assetLabel: string | null }>
  >();
  const assetLabels = new Map<string, string | null>();

  for (const trade of trades) {
    const ticker = resolveTicker(trade);
    if (!ticker) continue;
    const amt = amountMid(trade);
    if (amt <= 0) continue;
    if (!assetLabels.has(ticker) && trade.assetName) {
      assetLabels.set(ticker, assetLabelFromTrade(trade));
    }
    let byPolitician = byTickerPolitician.get(ticker);
    if (!byPolitician) {
      byPolitician = new Map();
      byTickerPolitician.set(ticker, byPolitician);
    }
    let row = byPolitician.get(trade.politicianKey);
    if (!row) {
      row = { buy: 0, sell: 0, assetLabel: assetLabelFromTrade(trade) };
      byPolitician.set(trade.politicianKey, row);
    }
    if (trade.transactionCategory === "buy") row.buy = roundUsd(row.buy + amt);
    else if (trade.transactionCategory === "sell") row.sell = roundUsd(row.sell + amt);
  }

  const priorTop10 = computePriorTop10Tickers(bundles, chamber, period);
  const stocks: PoliticianMostAccumulatedRow[] = [];

  for (const [ticker, byPolitician] of byTickerPolitician) {
    let politiciansBuying = 0;
    let politiciansSelling = 0;
    let totalBuyUsd = 0;
    let totalSellUsd = 0;
    let tradeCount = 0;

    for (const row of byPolitician.values()) {
      const net = row.buy - row.sell;
      totalBuyUsd = roundUsd(totalBuyUsd + row.buy);
      totalSellUsd = roundUsd(totalSellUsd + row.sell);
      if (net > 0) politiciansBuying += 1;
      if (net < 0) politiciansSelling += 1;
      if (row.buy > 0 || row.sell > 0) tradeCount += 1;
    }

    const netAmountUsd = roundUsd(totalBuyUsd - totalSellUsd);
    const percentIncrease =
      totalBuyUsd > 0 ? roundPct((netAmountUsd / totalBuyUsd) * 100) : netAmountUsd > 0 ? null : 0;

    stocks.push({
      ticker,
      assetLabel: assetLabels.get(ticker) ?? null,
      politiciansBuying,
      politiciansSelling,
      netAmountUsd,
      totalBuyUsd,
      totalSellUsd,
      percentIncrease,
      totalPoliticiansActive: byPolitician.size,
      tradeCount,
      highlightManyPoliticians: politiciansBuying > 10,
      highlightHighIncrease: percentIncrease != null && percentIncrease > 25,
      isNewTop10: false,
    });
  }

  stocks.sort((a, b) => b.netAmountUsd - a.netAmountUsd);
  const top10 = new Set(stocks.slice(0, 10).map((r) => r.ticker));
  for (const row of stocks) {
    row.isNewTop10 = top10.has(row.ticker) && !priorTop10.has(row.ticker);
  }

  const pctValues = stocks
    .map((r) => r.percentIncrease)
    .filter((v): v is number => v != null && Number.isFinite(v));

  return {
    period,
    periodLabel: periodLabel(period),
    chamber,
    available: true,
    unavailableReason: null,
    fetchedAt: payload.fetchedAt,
    summary: {
      topStock: stocks[0]
        ? {
            ticker: stocks[0].ticker,
            assetLabel: stocks[0].assetLabel,
            netAmountUsd: stocks[0].netAmountUsd,
          }
        : null,
      totalPoliticiansBuying: stocks.reduce((sum, r) => sum + r.politiciansBuying, 0),
      totalNetAmountUsd: roundUsd(stocks.reduce((sum, r) => sum + r.netAmountUsd, 0)),
      averagePercentIncrease:
        pctValues.length > 0
          ? roundPct(pctValues.reduce((a, b) => a + b, 0) / pctValues.length)
          : null,
    },
    stocks,
  };
}

export function computePoliticianLargestPortfolios(
  period: PoliticianAnalyticsPeriod = "quarter",
  chamber: PoliticianChamberFilter = "all"
): PoliticianLargestPortfoliosPayload {
  const payload = readPoliticiansRecent();
  if (!payload) {
    return {
      period,
      periodLabel: periodLabel(period),
      chamber,
      available: false,
      unavailableReason: "No politician data yet. Run: npm run politicians:fetch-recent",
      fetchedAt: null,
      politicians: [],
    };
  }

  const trades = flattenTrades([...payload.house, ...payload.senate], chamber, period);
  if (!trades.length) {
    return {
      period,
      periodLabel: periodLabel(period),
      chamber,
      available: false,
      unavailableReason: `No congressional trades in the ${periodLabel(period).toLowerCase()} window.`,
      fetchedAt: payload.fetchedAt,
      politicians: [],
    };
  }

  const byPolitician = new Map<
    string,
    PoliticianPortfolioRow & { buyCount: number; sellCount: number }
  >();

  for (const trade of trades) {
    const amt = amountMid(trade);
    if (amt <= 0) continue;
    let row = byPolitician.get(trade.politicianKey);
    if (!row) {
      row = {
        politicianKey: trade.politicianKey,
        politicianName: trade.politicianName,
        chamber: trade.chamber,
        state: trade.state ? String(trade.state) : null,
        totalBuyUsd: 0,
        totalSellUsd: 0,
        netPortfolioUsd: 0,
        buyCount: 0,
        sellCount: 0,
        tradeCount: 0,
      };
      byPolitician.set(trade.politicianKey, row);
    }
    row.tradeCount += 1;
    if (trade.transactionCategory === "buy") {
      row.totalBuyUsd = roundUsd(row.totalBuyUsd + amt);
      row.buyCount += 1;
    } else if (trade.transactionCategory === "sell") {
      row.totalSellUsd = roundUsd(row.totalSellUsd + amt);
      row.sellCount += 1;
    }
    row.netPortfolioUsd = roundUsd(row.totalBuyUsd - row.totalSellUsd);
  }

  const politicians = [...byPolitician.values()].sort(
    (a, b) => b.netPortfolioUsd - a.netPortfolioUsd
  );

  return {
    period,
    periodLabel: periodLabel(period),
    chamber,
    available: true,
    unavailableReason: null,
    fetchedAt: payload.fetchedAt,
    politicians,
  };
}

export function parsePoliticianAnalyticsPeriod(raw: string | null): PoliticianAnalyticsPeriod {
  if (raw === "30d" || raw === "year") return raw;
  return "quarter";
}

export function parsePoliticianChamberFilter(raw: string | null): PoliticianChamberFilter {
  if (raw === "house" || raw === "senate") return raw;
  return "all";
}

export {
  amountMid,
  resolveTicker,
  politicianKey,
  tradeDate,
  parseTradeDateMs,
  flattenTrades,
};

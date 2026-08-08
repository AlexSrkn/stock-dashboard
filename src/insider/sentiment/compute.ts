import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadOpenMarketSentimentTrades, loadSharesOutstandingMap } from "./queries.js";
import {
  buyerRatioToScore,
  computeSentimentScore,
  parseDateMs,
  percentileScores,
  percentileToSigned,
  round2,
  round4,
  sentimentClassification,
} from "./score.js";
import type {
  InsiderSentimentCachePayload,
  InsiderSentimentRow,
  RawSentimentTrade,
} from "./types.js";

function txTime(row: RawSentimentTrade): number {
  return parseDateMs(row.transactionDate) || parseDateMs(row.filingDate) || 0;
}

interface Acc {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  buyTransactions: number;
  sellTransactions: number;
  buyValue: number;
  sellValue: number;
  buyShares: number;
  sellShares: number;
  buyers: Set<string>;
  sellers: Set<string>;
  firstMs: number;
  latestMs: number;
  lastPx: number | null;
}

function emptyAcc(row: RawSentimentTrade): Acc {
  return {
    ticker: row.ticker,
    companyName: row.companyName,
    sector: row.sector,
    buyTransactions: 0,
    sellTransactions: 0,
    buyValue: 0,
    sellValue: 0,
    buyShares: 0,
    sellShares: 0,
    buyers: new Set(),
    sellers: new Set(),
    firstMs: Number.POSITIVE_INFINITY,
    latestMs: Number.NEGATIVE_INFINITY,
    lastPx: null,
  };
}

export async function computeInsiderSentiment(
  pool: pg.Pool = getPool(),
  opts: { dateFrom?: string | null; dateTo?: string | null } = {}
): Promise<InsiderSentimentCachePayload> {
  const [trades, sharesOutstanding] = await Promise.all([
    loadOpenMarketSentimentTrades(pool, opts),
    loadSharesOutstandingMap(pool),
  ]);

  const byTicker = new Map<string, Acc>();
  for (const row of trades) {
    let acc = byTicker.get(row.ticker);
    if (!acc) {
      acc = emptyAcc(row);
      byTicker.set(row.ticker, acc);
    }
    if (row.companyName && !acc.companyName) acc.companyName = row.companyName;
    if (row.sector && !acc.sector) acc.sector = row.sector;

    const t = txTime(row);
    if (t > 0) {
      if (t < acc.firstMs) acc.firstMs = t;
      if (t > acc.latestMs) {
        acc.latestMs = t;
        acc.lastPx =
          row.pricePerShare != null && row.pricePerShare > 0
            ? row.pricePerShare
            : row.shares > 0
              ? row.valueUsd / row.shares
              : acc.lastPx;
      }
    }

    const name = row.insiderName.trim().toLowerCase();
    if (row.transactionCode === "P") {
      acc.buyTransactions += 1;
      acc.buyValue += row.valueUsd;
      acc.buyShares += row.shares;
      if (name) acc.buyers.add(name);
    } else {
      acc.sellTransactions += 1;
      acc.sellValue += row.valueUsd;
      acc.sellShares += row.shares;
      if (name) acc.sellers.add(name);
    }
  }

  const drafts = [...byTicker.values()]
    .filter((a) => a.buyTransactions + a.sellTransactions > 0)
    .map((a) => {
      const uniqueBuyers = a.buyers.size;
      const uniqueSellers = a.sellers.size;
      const uniqueInsiders = new Set([...a.buyers, ...a.sellers]).size;
      const denom = uniqueBuyers + uniqueSellers;
      const buyerRatio = denom > 0 ? uniqueBuyers / denom : 0;
      const netDollarFlow = a.buyValue - a.sellValue;
      const netShares = a.buyShares - a.sellShares;
      const buySellTransactionRatio =
        a.sellTransactions > 0 ? a.buyTransactions / a.sellTransactions : null;
      const buySellDollarRatio = a.sellValue > 0 ? a.buyValue / a.sellValue : null;
      const so = sharesOutstanding.get(a.ticker);
      const marketCapUsd =
        so != null && a.lastPx != null && a.lastPx > 0 ? round2(so * a.lastPx) : null;

      return {
        ticker: a.ticker,
        companyName: a.companyName,
        sector: a.sector,
        marketCapUsd,
        buyTransactions: a.buyTransactions,
        sellTransactions: a.sellTransactions,
        buyValue: round2(a.buyValue),
        sellValue: round2(a.sellValue),
        netDollarFlow: round2(netDollarFlow),
        buyShares: round2(a.buyShares),
        sellShares: round2(a.sellShares),
        netShares: round2(netShares),
        uniqueBuyers,
        uniqueSellers,
        uniqueInsiders,
        buyerRatio: round4(buyerRatio),
        buySellTransactionRatio:
          buySellTransactionRatio != null ? round4(buySellTransactionRatio) : null,
        buySellDollarRatio: buySellDollarRatio != null ? round4(buySellDollarRatio) : null,
        totalTrades: a.buyTransactions + a.sellTransactions,
        firstTrade: Number.isFinite(a.firstMs) ? new Date(a.firstMs).toISOString().slice(0, 10) : null,
        latestTrade: Number.isFinite(a.latestMs)
          ? new Date(a.latestMs).toISOString().slice(0, 10)
          : null,
      };
    });

  const netDollarScores = percentileScores(drafts.map((d) => d.netDollarFlow)).map(percentileToSigned);
  const netSharesScores = percentileScores(drafts.map((d) => d.netShares)).map(percentileToSigned);
  const uniqueBuyerScores = percentileScores(drafts.map((d) => d.uniqueBuyers)).map(
    percentileToSigned
  );

  const rows: InsiderSentimentRow[] = drafts.map((d, i) => {
    const buyerRatioScore = buyerRatioToScore(d.buyerRatio);
    const sentimentScore = computeSentimentScore({
      netDollarFlowScore: netDollarScores[i] ?? 0,
      buyerRatioScore,
      uniqueBuyersScore: uniqueBuyerScores[i] ?? 0,
      netSharesScore: netSharesScores[i] ?? 0,
    });

    return {
      ...d,
      sentimentScore,
      classification: sentimentClassification(sentimentScore),
    };
  });

  rows.sort(
    (a, b) =>
      b.sentimentScore - a.sentimentScore ||
      b.netDollarFlow - a.netDollarFlow ||
      a.ticker.localeCompare(b.ticker)
  );

  const sectors = [
    ...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s))),
  ].sort((a, b) => a.localeCompare(b));

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    rows,
    sectors,
  };
}

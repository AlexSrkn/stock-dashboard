import type pg from "pg";
import { getPool } from "../db/pool.js";
import { queryInsiderTransactionsByTicker } from "../db/insiderTransactions.js";
import { getCongressTradesForTicker } from "../politicians/byTicker.js";
import type { PoliticianTrade } from "../politicians/types.js";
import { getSmartMoneyService } from "../smartMoney/smartMoneyService.js";
import type { SmartMoneyScore } from "../smartMoney/types.js";
import { classifyActivityTrend, type ActivityTrend } from "./activityTrend.js";
import { loadOwnershipMeta } from "./ownershipAnalytics.js";
import {
  fetchCachedTopHolders,
  fetchFilerSharesByCusipQuarter,
  loadOwnershipCacheSnapshot,
} from "./ownershipCacheReader.js";
import type { FundHoldingAggregate } from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function holdingsByFiler(
  map: Map<string, FundHoldingAggregate>
): Map<string, FundHoldingAggregate> {
  const out = new Map<string, FundHoldingAggregate>();
  for (const h of map.values()) {
    out.set(h.filerCik || h.fundName, h);
  }
  return out;
}

function trendFromOwnershipCache(raw: string | null): ActivityTrend | null {
  const t = String(raw || "").toLowerCase();
  if (t === "increasing" || t === "bullish") return "bullish";
  if (t === "decreasing" || t === "bearish") return "bearish";
  if (t === "neutral") return "neutral";
  return null;
}

function countHolders(map: Map<string, FundHoldingAggregate>): number {
  let n = 0;
  for (const h of map.values()) {
    if (h.shares > 0) n++;
  }
  return n;
}

function countNewPositions(
  current: Map<string, FundHoldingAggregate>,
  previous: Map<string, FundHoldingAggregate>
): number {
  let n = 0;
  for (const [fundName, cur] of current) {
    if (cur.shares <= 0) continue;
    const prev = previous.get(fundName);
    if (!prev || prev.shares <= 0) n++;
  }
  return n;
}

function computeShareFlow(
  current: Map<string, FundHoldingAggregate>,
  previous: Map<string, FundHoldingAggregate>
): { buyShares: number; sellShares: number; netShares: number; trend: ActivityTrend } {
  const funds = new Set([...current.keys(), ...previous.keys()]);
  let buyShares = 0;
  let sellShares = 0;
  for (const fundName of funds) {
    const cur = current.get(fundName)?.shares ?? 0;
    const prev = previous.get(fundName)?.shares ?? 0;
    const delta = cur - prev;
    if (delta > 0) buyShares += delta;
    else if (delta < 0) sellShares += Math.abs(delta);
  }
  const netShares = round2(buyShares - sellShares);
  return {
    buyShares: round2(buyShares),
    sellShares: round2(sellShares),
    netShares,
    trend: classifyActivityTrend(netShares, buyShares, sellShares),
  };
}

function politicianTradeAmountMid(trade: PoliticianTrade): number {
  const min = Number(trade.amountMin);
  const max = Number(trade.amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) {
    return (min + max) / 2;
  }
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

function computePoliticianActivity(trades: PoliticianTrade[]) {
  let buyTotal = 0;
  let sellTotal = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const trade of trades) {
    const amt = politicianTradeAmountMid(trade);
    if (trade.transactionCategory === "buy") {
      buyCount++;
      buyTotal += amt;
    } else if (trade.transactionCategory === "sell") {
      sellCount++;
      sellTotal += amt;
    }
  }
  const net = round2(buyTotal - sellTotal);
  return {
    trend: classifyActivityTrend(net, buyTotal, sellTotal),
    buyCount,
    sellCount,
    netAmountUsd: net,
  };
}

function isInsiderBuy(code: string, ad: string | null): boolean {
  const c = code.trim().toUpperCase();
  if (c === "P") return true;
  return String(ad || "").toUpperCase() === "A";
}

function isInsiderSell(code: string, ad: string | null): boolean {
  const c = code.trim().toUpperCase();
  if (c === "S") return true;
  return String(ad || "").toUpperCase() === "D";
}

export interface OwnershipIntelligenceResponse {
  meta: {
    ticker: string;
    currentQuarter: string | null;
    previousQuarter: string | null;
    trackedFundCount: number;
    institutionalOwnership: number | null;
    politicianDataAt: string | null;
  };
  institutional: {
    trend: ActivityTrend;
    ownershipPct: number | null;
    institutionCountChange: number | null;
    newPositions: number;
    netShares: number;
    buyShares: number;
    sellShares: number;
  };
  insider: {
    trend: ActivityTrend;
    netShares: number;
    netValueUsd: number | null;
    buyShares: number;
    sellShares: number;
  };
  politician: {
    trend: ActivityTrend;
    buyCount: number;
    sellCount: number;
    netAmountUsd: number;
  };
  smartMoney: SmartMoneyScore | null;
}

export async function getOwnershipIntelligence(
  ticker: string,
  pool: pg.Pool = getPool()
): Promise<OwnershipIntelligenceResponse> {
  const sym = String(ticker || "").trim().toUpperCase();

  const politicianPayload = getCongressTradesForTicker(sym);

  let meta = {
    ticker: sym,
    currentQuarter: null as string | null,
    previousQuarter: null as string | null,
    trackedFundCount: 0,
    institutionalOwnership: null as number | null,
    politicianDataAt: politicianPayload.fetchedAt,
  };

  let institutional = {
    trend: "neutral" as ActivityTrend,
    ownershipPct: null as number | null,
    institutionCountChange: null as number | null,
    newPositions: 0,
    netShares: 0,
    buyShares: 0,
    sellShares: 0,
  };

  let insider = {
    trend: "neutral" as ActivityTrend,
    netShares: 0,
    netValueUsd: null as number | null,
    buyShares: 0,
    sellShares: 0,
  };

  const politician = computePoliticianActivity(politicianPayload.trades);

  let smartMoney: SmartMoneyScore | null = null;
  try {
    smartMoney = await getSmartMoneyService().getScoreForTicker(sym);
  } catch {
    /* optional */
  }

  try {
    const ownershipMeta = await loadOwnershipMeta(pool, sym);
    meta = {
      ...meta,
      currentQuarter: ownershipMeta.currentQuarter || null,
      previousQuarter: ownershipMeta.previousQuarter,
      trackedFundCount: ownershipMeta.trackedFundCount,
    };

    const snapshot = await loadOwnershipCacheSnapshot(pool, sym).catch(() => null);
    if (snapshot?.institutionalOwnershipPct != null) {
      institutional.ownershipPct = snapshot.institutionalOwnershipPct;
      meta.institutionalOwnership = snapshot.institutionalOwnershipPct / 100;
    }

    if (ownershipMeta.currentQuarter) {
      const currentHolders = await fetchCachedTopHolders(
        pool,
        ownershipMeta.ticker,
        ownershipMeta.impliedSharesOutstanding,
        ownershipMeta.stockPrice,
        20000
      );
      const current = holdingsByFiler(new Map(currentHolders.map((h) => [h.filerCik || h.fundName, h])));
      const previous =
        ownershipMeta.previousQuarter && ownershipMeta.cusips.length
          ? await fetchFilerSharesByCusipQuarter(
              pool,
              ownershipMeta.cusips,
              ownershipMeta.previousQuarter
            )
          : new Map();
      const flow = computeShareFlow(current, previous);
      const currentCount = countHolders(current);
      const previousCount = countHolders(previous);
      institutional = {
        ...institutional,
        trend: flow.trend !== "neutral" ? flow.trend : trendFromOwnershipCache(snapshot?.ownershipTrend) ?? flow.trend,
        ownershipPct: snapshot?.institutionalOwnershipPct ?? institutional.ownershipPct,
        institutionCountChange:
          previousCount > 0 || currentCount > 0 ? currentCount - previousCount : null,
        newPositions: countNewPositions(current, previous),
        netShares: flow.netShares,
        buyShares: flow.buyShares,
        sellShares: flow.sellShares,
      };
    } else if (snapshot) {
      const netShares = round2(snapshot.currentShares - snapshot.previousShares);
      const buyShares = netShares > 0 ? netShares : 0;
      const sellShares = netShares < 0 ? Math.abs(netShares) : 0;
      institutional = {
        ...institutional,
        trend:
          trendFromOwnershipCache(snapshot.ownershipTrend) ??
          classifyActivityTrend(netShares, buyShares, sellShares),
        ownershipPct: snapshot.institutionalOwnershipPct ?? institutional.ownershipPct,
        netShares,
        buyShares: round2(buyShares),
        sellShares: round2(sellShares),
      };
    }
  } catch {
    /* 13F data optional */
  }

  try {
    const transactions = await queryInsiderTransactionsByTicker(
      sym,
      { limit: 500, signal: "high", codes: ["P", "S"] },
      pool
    );
    let buyShares = 0;
    let sellShares = 0;
    let netValueUsd = 0;
    for (const row of transactions) {
      const shares = Number(row.shares);
      if (!Number.isFinite(shares) || shares <= 0) continue;
      const value = Number(row.transactionValue);
      const valueUsd = Number.isFinite(value) ? value : 0;
      if (isInsiderBuy(row.transactionCode, row.acquisitionDisposition)) {
        buyShares += shares;
        netValueUsd += valueUsd;
      } else if (isInsiderSell(row.transactionCode, row.acquisitionDisposition)) {
        sellShares += shares;
        netValueUsd -= valueUsd;
      }
    }
    const netShares = round2(buyShares - sellShares);
    insider = {
      trend: classifyActivityTrend(netShares, buyShares, sellShares),
      netShares,
      netValueUsd: round2(netValueUsd),
      buyShares: round2(buyShares),
      sellShares: round2(sellShares),
    };
  } catch {
    /* insider data optional */
  }

  return {
    meta,
    institutional,
    insider,
    politician,
    smartMoney,
  };
}

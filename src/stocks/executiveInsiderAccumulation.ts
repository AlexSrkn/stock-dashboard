import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadInsiderBuyRows } from "../insiderCluster/dataLoader.js";
import type { ClusterLookbackDays } from "../insiderCluster/types.js";
import { DEFAULT_CLUSTER_LOOKBACK_DAYS } from "../insiderCluster/types.js";

export interface ExecutiveInsiderAccumulationRow {
  ticker: string;
  totalBuyValue: number;
  buyerCount: number;
  ceoCount: number;
  cfoCount: number;
}

export interface ExecutiveInsiderAccumulationPayload {
  computedAt: string;
  lookbackDays: ClusterLookbackDays;
  count: number;
  stocks: ExecutiveInsiderAccumulationRow[];
}

function isCeoTitle(title: string | null | undefined): boolean {
  const t = String(title || "").trim();
  return /\bceo\b|chief executive officer/i.test(t);
}

function isCfoTitle(title: string | null | undefined): boolean {
  const t = String(title || "").trim();
  return /\bcfo\b|chief financial officer/i.test(t);
}

function isExecutiveTitle(title: string | null | undefined): boolean {
  return isCeoTitle(title) || isCfoTitle(title);
}

function buyerKey(name: string): string {
  return String(name || "").trim().toLowerCase();
}

export async function loadExecutiveInsiderAccumulation(
  lookbackDays: ClusterLookbackDays = DEFAULT_CLUSTER_LOOKBACK_DAYS,
  pool: pg.Pool = getPool(),
  limit = 100
): Promise<ExecutiveInsiderAccumulationPayload> {
  const rows = await loadInsiderBuyRows(lookbackDays, pool);
  const byTicker = new Map<
    string,
    {
      buyers: Map<string, { isCeo: boolean; isCfo: boolean }>;
      totalBuyValue: number;
    }
  >();

  for (const row of rows) {
    if (!isExecutiveTitle(row.insiderTitle)) continue;
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!ticker) continue;

    let acc = byTicker.get(ticker);
    if (!acc) {
      acc = { buyers: new Map(), totalBuyValue: 0 };
      byTicker.set(ticker, acc);
    }

    const key = buyerKey(row.insiderName);
    const existing = acc.buyers.get(key);
    const isCeo = isCeoTitle(row.insiderTitle);
    const isCfo = isCfoTitle(row.insiderTitle);
    if (!existing) {
      acc.buyers.set(key, { isCeo, isCfo });
    } else {
      if (isCeo) existing.isCeo = true;
      if (isCfo) existing.isCfo = true;
    }

    const value = Math.abs(Number(row.transactionValue) || 0);
    if (Number.isFinite(value) && value > 0) acc.totalBuyValue += value;
  }

  const stocks = [...byTicker.entries()]
    .map(([ticker, acc]) => {
      let ceoCount = 0;
      let cfoCount = 0;
      for (const buyer of acc.buyers.values()) {
        if (buyer.isCeo) ceoCount += 1;
        if (buyer.isCfo) cfoCount += 1;
      }
      return {
        ticker,
        totalBuyValue: Math.round(acc.totalBuyValue),
        buyerCount: acc.buyers.size,
        ceoCount,
        cfoCount,
      };
    })
    .sort((a, b) => b.totalBuyValue - a.totalBuyValue || b.buyerCount - a.buyerCount)
    .slice(0, Math.max(1, limit));

  return {
    computedAt: new Date().toISOString(),
    lookbackDays,
    count: stocks.length,
    stocks,
  };
}

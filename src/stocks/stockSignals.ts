import type pg from "pg";
import { getPool } from "../db/pool.js";
import { queryInsiderTransactionsByTicker } from "../db/insiderTransactions.js";
import { getCongressTradesForTicker } from "../politicians/byTicker.js";
import type { PoliticianTrade } from "../politicians/types.js";
import { fetchQuarterPairMap, loadOwnershipMeta } from "../ownership/ownershipAnalytics.js";
import { getStockSignalsRepository } from "./stockSignalsRepository.js";
import { buildStockCachedSignals } from "./stockCachedSignals.js";

/** Buying is "High" when one side is at least this multiple of the other. */
const HIGH_RATIO = 2.5;

export type SignalCategory =
  | "institutional"
  | "insider"
  | "politician"
  | "smart-money"
  | "double-signal"
  | "triple-signal"
  | "top-institution-entry"
  | "hidden-gem"
  | "conflict-signal"
  | "institutional-discovery"
  | "conviction-score";
export type SignalDirection = "buying" | "selling" | "neutral";
export type SignalStrength = "high" | "normal" | "neutral";

export interface StockSignal {
  category: SignalCategory;
  /** Human label, e.g. "High Institutional Buying". */
  label: string;
  direction: SignalDirection;
  strength: SignalStrength;
  buyValueUsd: number;
  sellValueUsd: number;
  netValueUsd: number;
  /** Dominant-side ratio (buy/sell when buying, sell/buy when selling). */
  ratio: number | null;
  /** Cached hub signals only — link to the signals hub. */
  href?: string;
  /** Cached hub signals — override stat column labels. */
  statLabels?: { buy: string; sell: string; net: string };
  /** Cached hub signals — format stats as numbers instead of USD. */
  statValuesAreNumeric?: boolean;
  /** Cached hub signals — short description shown under stats. */
  hint?: string | null;
}

export interface StockSignalsResponse {
  ticker: string;
  computedAt: string;
  signals: StockSignal[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Turn aggregated buy/sell magnitudes into a directional signal.
 * Buying when buy > sell; "High" prefix when the dominant side is ≥ 2.5× the other.
 */
function classifySignal(
  category: SignalCategory,
  buy: number,
  sell: number,
  nounBuying: string,
  nounSelling: string
): StockSignal {
  const buyValueUsd = round2(Math.max(0, buy));
  const sellValueUsd = round2(Math.max(0, sell));
  const netValueUsd = round2(buyValueUsd - sellValueUsd);

  if (buyValueUsd <= 0 && sellValueUsd <= 0) {
    return {
      category,
      label: "No activity",
      direction: "neutral",
      strength: "neutral",
      buyValueUsd,
      sellValueUsd,
      netValueUsd,
      ratio: null,
    };
  }

  if (buyValueUsd > sellValueUsd) {
    const ratio = sellValueUsd > 0 ? round2(buyValueUsd / sellValueUsd) : null;
    const high = sellValueUsd <= 0 || buyValueUsd >= HIGH_RATIO * sellValueUsd;
    return {
      category,
      label: high ? `High ${nounBuying}` : nounBuying,
      direction: "buying",
      strength: high ? "high" : "normal",
      buyValueUsd,
      sellValueUsd,
      netValueUsd,
      ratio,
    };
  }

  if (sellValueUsd > buyValueUsd) {
    const ratio = buyValueUsd > 0 ? round2(sellValueUsd / buyValueUsd) : null;
    const high = buyValueUsd <= 0 || sellValueUsd >= HIGH_RATIO * buyValueUsd;
    return {
      category,
      label: high ? `High ${nounSelling}` : nounSelling,
      direction: "selling",
      strength: high ? "high" : "normal",
      buyValueUsd,
      sellValueUsd,
      netValueUsd,
      ratio,
    };
  }

  return {
    category,
    label: "Balanced",
    direction: "neutral",
    strength: "neutral",
    buyValueUsd,
    sellValueUsd,
    netValueUsd,
    ratio: 1,
  };
}

/**
 * Institutional flow: quarter-over-quarter change in tracked 13F holdings.
 * Value added by buyers vs value removed by sellers (price × share delta).
 */
async function computeInstitutionalSignal(pool: pg.Pool, ticker: string): Promise<StockSignal> {
  let buyValue = 0;
  let sellValue = 0;

  try {
    const meta = await loadOwnershipMeta(pool, ticker);
    if (meta.currentQuarter && meta.previousQuarter) {
      const { current, previous } = await fetchQuarterPairMap(
        pool,
        meta.cusips,
        meta.currentQuarter,
        meta.previousQuarter,
        meta.impliedSharesOutstanding,
        meta.stockPrice,
        meta.ticker
      );
      const price = meta.stockPrice && meta.stockPrice > 0 ? meta.stockPrice : 1;
      const funds = new Set([...current.keys(), ...previous.keys()]);
      for (const fund of funds) {
        const cur = current.get(fund)?.shares ?? 0;
        const prev = previous.get(fund)?.shares ?? 0;
        const delta = cur - prev;
        if (delta > 0) buyValue += delta * price;
        else if (delta < 0) sellValue += Math.abs(delta) * price;
      }
    }
  } catch {
    /* 13F data optional */
  }

  return classifySignal(
    "institutional",
    buyValue,
    sellValue,
    "Institutional Buying",
    "Institutional Selling"
  );
}

/** Insider flow: Form 4 open-market buys (P / acquisitions) vs sells (S / dispositions). */
async function computeInsiderSignal(pool: pg.Pool, ticker: string): Promise<StockSignal> {
  let buyValue = 0;
  let sellValue = 0;

  try {
    const transactions = await queryInsiderTransactionsByTicker(
      ticker,
      { limit: 500, codes: ["P", "S"] },
      pool
    );
    for (const t of transactions) {
      const value = Number(t.transactionValue);
      if (!Number.isFinite(value) || value <= 0) continue;
      const code = String(t.transactionCode || "").trim().toUpperCase();
      const ad = String(t.acquisitionDisposition || "").trim().toUpperCase();
      if (code === "P" || ad === "A") buyValue += value;
      else if (code === "S" || ad === "D") sellValue += value;
    }
  } catch {
    /* insider data optional */
  }

  return classifySignal("insider", buyValue, sellValue, "Insider Buying", "Insider Selling");
}

function politicianTradeAmountMid(trade: PoliticianTrade): number {
  const min = Number(trade.amountMin);
  const max = Number(trade.amountMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > 0) return (min + max) / 2;
  if (Number.isFinite(min) && min > 0) return min;
  if (Number.isFinite(max) && max > 0) return max;
  return 0;
}

/** Politician flow: congressional buys vs sells (mid-point of reported amount ranges). */
function computePoliticianSignal(ticker: string): StockSignal {
  let buyValue = 0;
  let sellValue = 0;

  const { trades } = getCongressTradesForTicker(ticker);
  for (const trade of trades) {
    const amount = politicianTradeAmountMid(trade);
    if (amount <= 0) continue;
    if (trade.transactionCategory === "buy") buyValue += amount;
    else if (trade.transactionCategory === "sell") sellValue += amount;
  }

  return classifySignal("politician", buyValue, sellValue, "Politician Buying", "Politician Selling");
}

/**
 * Compute the three activity signals for a ticker and (optionally) persist them.
 */
export async function computeStockSignals(
  ticker: string,
  pool: pg.Pool = getPool(),
  options: { persist?: boolean } = {}
): Promise<StockSignalsResponse> {
  const sym = String(ticker || "").trim().toUpperCase();
  if (!sym) throw new Error("Missing ticker");

  const [institutional, insider] = await Promise.all([
    computeInstitutionalSignal(pool, sym),
    computeInsiderSignal(pool, sym),
  ]);
  const politician = computePoliticianSignal(sym);

  const flowSignals = [institutional, insider, politician];
  const cachedSignals = buildStockCachedSignals(sym);
  const signals = [...flowSignals, ...cachedSignals];
  const computedAt = new Date().toISOString();

  if (options.persist !== false) {
    try {
      await getStockSignalsRepository(pool).saveSignals(sym, flowSignals);
    } catch {
      /* persistence is best-effort; never block the response */
    }
  }

  return { ticker: sym, computedAt, signals };
}

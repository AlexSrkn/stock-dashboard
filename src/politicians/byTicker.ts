import { cleanPoliticianTicker } from "./normalize.js";
import { readPoliticiansRecent } from "./recent.js";
import type { PoliticianTrade } from "./types.js";

export function normalizeTicker(sym: string): string {
  return cleanPoliticianTicker(sym) || "";
}

export function tradeMatchesTicker(trade: PoliticianTrade, sym: string): boolean {
  const ticker = normalizeTicker(sym);
  if (normalizeTicker(trade.ticker || "") === ticker) return true;
  const paren = trade.assetName?.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/i);
  return normalizeTicker(paren?.[1] || "") === ticker;
}

export function isCongressBuy(trade: PoliticianTrade): boolean {
  return trade.transactionCategory === "buy";
}

export function isCongressSell(trade: PoliticianTrade): boolean {
  return trade.transactionCategory === "sell";
}

export function getCongressTradesForTicker(ticker: string): {
  fetchedAt: string | null;
  trades: PoliticianTrade[];
} {
  const payload = readPoliticiansRecent();
  if (!payload) return { fetchedAt: null, trades: [] };

  const sym = normalizeTicker(ticker);
  const trades: PoliticianTrade[] = [];
  for (const bundle of [...payload.house, ...payload.senate]) {
    for (const trade of bundle.trades) {
      if (tradeMatchesTicker(trade, sym)) {
        trades.push(trade);
      }
    }
  }

  trades.sort((a, b) => String(b.transactionDate || "").localeCompare(String(a.transactionDate || "")));
  return { fetchedAt: payload.fetchedAt, trades };
}

export function getCongressBuysForTicker(ticker: string): {
  fetchedAt: string | null;
  trades: PoliticianTrade[];
} {
  const { fetchedAt, trades } = getCongressTradesForTicker(ticker);
  return { fetchedAt, trades: trades.filter(isCongressBuy) };
}

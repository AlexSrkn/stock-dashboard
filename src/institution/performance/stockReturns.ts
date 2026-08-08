/** @deprecated Use priceCache.ts ReturnsMatrix instead. */
import type { ReturnsMatrix } from "./priceCache.js";
import type { QuarterlyStockReturn } from "./types.js";

export function getStockReturn(
  returnIndex: Map<string, Map<string, number | null>>,
  ticker: string,
  quarter: string
): number | null {
  return returnIndex.get(ticker.toUpperCase())?.get(quarter) ?? null;
}

export function returnsMatrixToIndex(matrix: ReturnsMatrix): Map<string, Map<string, number | null>> {
  const out = new Map<string, Map<string, number | null>>();
  for (const row of matrix.toRows()) {
    const byQ = out.get(row.ticker) ?? new Map();
    byQ.set(row.quarter, row.return);
    out.set(row.ticker, byQ);
  }
  return out;
}

export async function computeQuarterlyStockReturns(
  _tickers: string[],
  _quarters: string[],
  _priceProvider: unknown
): Promise<{
  returns: QuarterlyStockReturn[];
  returnIndex: Map<string, Map<string, number | null>>;
}> {
  throw new Error(
    "computeQuarterlyStockReturns with live PriceProvider is removed. Use priceCache.warmReturnsMatrix() and ReturnsMatrix."
  );
}

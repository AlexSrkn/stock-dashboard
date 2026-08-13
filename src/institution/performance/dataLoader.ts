import { priceOnOrBefore } from "./priceProvider.js";

export type DailyBar = { date: Date; close: number };
export type DailyBarsByTicker = Map<string, DailyBar[]>;

export interface BatchPriceLoadResult {
  barsByTicker: DailyBarsByTicker;
  requested: number;
  withBars: number;
  empty: number;
}

function parseIsoDate(date: string): Date | null {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Batch price history used to rebuild ticker-quarter returns.
 * Yahoo Finance was removed — restore `data/cache/ticker-quarter-returns.json`
 * or wire another provider before calling this.
 */
export async function loadAllPricesBatch(
  tickers: string[],
  _startDate: string,
  _endDate: string,
  _concurrency = 8
): Promise<BatchPriceLoadResult> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))];
  throw new Error(
    "Live price batch fetch is disabled (Yahoo Finance removed). " +
      "Restore data/cache/ticker-quarter-returns.json or add another price provider. " +
      `Requested ${unique.length} ticker(s).`
  );
}

/** Lookup close on or before ISO date from preloaded bars. */
export function closeOnOrBefore(bars: DailyBar[], isoDate: string): number | null {
  const target = parseIsoDate(isoDate);
  if (!target) return null;
  return priceOnOrBefore(bars, target);
}

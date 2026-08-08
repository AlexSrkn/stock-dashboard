import type { PriceData } from "./types.js";

/** Close on or before target date from sorted daily bars. */
export function priceOnOrBefore(
  bars: Array<{ date: Date; close: number }>,
  target: Date
): number | null {
  let best: number | null = null;
  const targetMs = target.getTime();
  for (const bar of bars) {
    if (bar.date.getTime() > targetMs) break;
    if (Number.isFinite(bar.close) && bar.close > 0) best = bar.close;
  }
  return best;
}

/**
 * In-memory price map for tests building a ReturnsMatrix.
 */
export class MapPriceProvider {
  private readonly cache = new Map<string, number>();

  constructor(initial?: Iterable<PriceData>) {
    if (initial) {
      for (const row of initial) {
        this.set(row.ticker, row.date, row.price);
      }
    }
  }

  private key(ticker: string, date: string): string {
    return `${ticker.toUpperCase()}::${date}`;
  }

  set(ticker: string, date: string, price: number): void {
    this.cache.set(this.key(ticker, date), price);
  }

  getPrice(ticker: string, date: string): number | null {
    return this.cache.get(this.key(ticker, date)) ?? null;
  }
}

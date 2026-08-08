import { priceOnOrBefore } from "./priceProvider.js";
import {
  chartQuotesToDailyBars,
  getYahooFinance,
  YAHOO_SKIP_RESULT_VALIDATION,
  type YahooChartQuote,
} from "../../market/yahooClient.js";

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

function extractChartQuotes(chart: unknown): YahooChartQuote[] | undefined {
  if (!chart || typeof chart !== "object") return undefined;
  const quotes = (chart as { quotes?: YahooChartQuote[] }).quotes;
  return Array.isArray(quotes) ? quotes : undefined;
}

async function fetchTickerBars(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<DailyBar[]> {
  const sym = ticker.toUpperCase();
  const period1 = parseIsoDate(startDate);
  const period2 = parseIsoDate(endDate);
  if (!period1 || !period2) return [];

  try {
    const chart = await getYahooFinance().chart(
      sym,
      {
        period1,
        period2,
        interval: "1d",
      },
      YAHOO_SKIP_RESULT_VALIDATION
    );
    return chartQuotesToDailyBars(extractChartQuotes(chart));
  } catch (err) {
    const fallback = extractChartQuotes((err as { result?: unknown })?.result);
    if (fallback?.length) {
      return chartQuotesToDailyBars(fallback);
    }
    return [];
  }
}

/**
 * Batch-load daily close prices for many tickers.
 * Yahoo chart validation is skipped per symbol; we validate quotes locally.
 * Runs once per warmup job, never during ranking.
 */
export async function loadAllPricesBatch(
  tickers: string[],
  startDate: string,
  endDate: string,
  concurrency = 8
): Promise<BatchPriceLoadResult> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))];
  const barsByTicker: DailyBarsByTicker = new Map();
  let index = 0;
  let withBars = 0;

  const workers = Array.from({ length: Math.min(concurrency, unique.length || 1) }, async () => {
    while (index < unique.length) {
      const sym = unique[index++];
      const bars = await fetchTickerBars(sym, startDate, endDate);
      barsByTicker.set(sym, bars);
      if (bars.length) withBars++;
    }
  });

  await Promise.all(workers);

  return {
    barsByTicker,
    requested: unique.length,
    withBars,
    empty: unique.length - withBars,
  };
}

/** Lookup close on or before ISO date from preloaded bars. */
export function closeOnOrBefore(bars: DailyBar[], isoDate: string): number | null {
  const target = parseIsoDate(isoDate);
  if (!target) return null;
  return priceOnOrBefore(bars, target);
}

import type { Candle, TimeSeriesPoint } from "./types.js";
import { alignToCandles } from "./utils.js";

function trueRange(candles: Candle[], i: number): number {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const prevClose = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

/** ATR with Wilder smoothing (default period 14). */
export function computeAtr(candles: Candle[], period = 14): TimeSeriesPoint[] {
  if (candles.length <= period || period < 1) {
    return candles.map((c) => ({ time: c.time }));
  }

  const values: Array<number | undefined> = new Array(candles.length);
  let sumTr = 0;
  let atr: number | undefined;

  for (let i = 1; i <= period; i++) {
    sumTr += trueRange(candles, i);
  }
  atr = sumTr / period;
  values[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    const tr = trueRange(candles, i);
    atr = (atr! * (period - 1) + tr) / period;
    values[i] = atr;
  }

  return alignToCandles(candles, values);
}

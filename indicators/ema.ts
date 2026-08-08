import type { Candle, TimeSeriesPoint } from "./types.js";
import { alignToCandles } from "./utils.js";

/** Standard exponential moving average with SMA seed. */
export function computeEma(candles: Candle[], period: number): TimeSeriesPoint[] {
  if (!candles.length || period < 1) return [];

  const k = 2 / (period + 1);
  const values: Array<number | undefined> = new Array(candles.length);
  let sum = 0;
  let ema: number | undefined;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    if (i < period - 1) {
      sum += close;
      continue;
    }
    if (i === period - 1) {
      sum += close;
      ema = sum / period;
      values[i] = ema;
      continue;
    }
    ema = close * k + ema! * (1 - k);
    values[i] = ema;
  }

  return alignToCandles(candles, values);
}

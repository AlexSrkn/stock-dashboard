import type { Candle, TimeSeriesPoint } from "./types.js";
import { alignToCandles } from "./utils.js";

/** RSI with Wilder smoothing (default period 14). */
export function computeRsi(candles: Candle[], period = 14): TimeSeriesPoint[] {
  if (candles.length <= period || period < 1) {
    return candles.map((c) => ({ time: c.time }));
  }

  const values: Array<number | undefined> = new Array(candles.length);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  values[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    values[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }

  return alignToCandles(candles, values);
}

import type { BollingerResult, Candle } from "./types.js";
import { alignToCandles, populationStd, smaValues } from "./utils.js";

/** Bollinger Bands: SMA ± stdDev × σ (defaults 20, 2). */
export function computeBollinger(
  candles: Candle[],
  period = 20,
  stdDevMult = 2
): BollingerResult {
  if (!candles.length) {
    return { upper: [], middle: [], lower: [] };
  }

  const closes = candles.map((c) => c.close);
  const middleRaw = smaValues(closes, period);
  const upperRaw: Array<number | undefined> = new Array(candles.length);
  const lowerRaw: Array<number | undefined> = new Array(candles.length);

  for (let i = period - 1; i < candles.length; i++) {
    const mid = middleRaw[i];
    if (mid == null) continue;
    const window = closes.slice(i - period + 1, i + 1);
    const sd = populationStd(window, mid);
    upperRaw[i] = mid + stdDevMult * sd;
    lowerRaw[i] = mid - stdDevMult * sd;
  }

  return {
    upper: alignToCandles(candles, upperRaw),
    middle: alignToCandles(candles, middleRaw),
    lower: alignToCandles(candles, lowerRaw),
  };
}

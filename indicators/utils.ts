import type { Candle, TimeSeriesPoint } from "./types.js";

/** Map numeric values to candle times; undefined values omit `value`. */
export function alignToCandles(candles: Candle[], values: Array<number | undefined>): TimeSeriesPoint[] {
  return candles.map((c, i) => {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) return { time: c.time };
    return { time: c.time, value: v };
  });
}

/** Drop warmup points without a value (for chart rendering). */
export function plotPoints(series: TimeSeriesPoint[]): TimeSeriesPoint[] {
  return series.filter((p) => p.value != null && Number.isFinite(p.value));
}

export function typicalPrice(c: Candle): number {
  return (c.high + c.low + c.close) / 3;
}

export function smaValues(closes: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(closes.length);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function populationStd(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
}

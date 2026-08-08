import type { Candle, TimeSeriesPoint } from "./types.js";
/** Standard exponential moving average with SMA seed. */
export declare function computeEma(candles: Candle[], period: number): TimeSeriesPoint[];

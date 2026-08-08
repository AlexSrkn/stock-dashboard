import type { Candle, TimeSeriesPoint } from "./types.js";
/** Session-cumulative VWAP (no daily reset). */
export declare function computeVwap(candles: Candle[]): TimeSeriesPoint[];

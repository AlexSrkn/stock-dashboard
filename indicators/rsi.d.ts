import type { Candle, TimeSeriesPoint } from "./types.js";
/** RSI with Wilder smoothing (default period 14). */
export declare function computeRsi(candles: Candle[], period?: number): TimeSeriesPoint[];

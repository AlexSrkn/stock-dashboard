import type { Candle, TimeSeriesPoint } from "./types.js";
/** ATR with Wilder smoothing (default period 14). */
export declare function computeAtr(candles: Candle[], period?: number): TimeSeriesPoint[];

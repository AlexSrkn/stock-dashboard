import type { Candle, MacdResult } from "./types.js";
/** MACD (12, 26, 9): line, signal, histogram — aligned to candle index. */
export declare function computeMacd(candles: Candle[], fastPeriod?: number, slowPeriod?: number, signalPeriod?: number): MacdResult;

import type { BollingerResult, Candle } from "./types.js";
/** Bollinger Bands: SMA ± stdDev × σ (defaults 20, 2). */
export declare function computeBollinger(candles: Candle[], period?: number, stdDevMult?: number): BollingerResult;

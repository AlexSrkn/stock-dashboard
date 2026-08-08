import type { Candle, VolumeProfileBin } from "./types.js";
export type VolumeProfileOptions = {
    /** Price bucket width (e.g. 1 or 0.5). Auto-derived when omitted. */
    binSize?: number;
};
/** Approximate volume-at-price distribution using typical-price bins. */
export declare function computeVolumeProfile(candles: Candle[], options?: VolumeProfileOptions): VolumeProfileBin[];

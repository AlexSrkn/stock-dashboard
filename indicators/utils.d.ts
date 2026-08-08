import type { Candle, TimeSeriesPoint } from "./types.js";
/** Map numeric values to candle times; undefined values omit `value`. */
export declare function alignToCandles(candles: Candle[], values: Array<number | undefined>): TimeSeriesPoint[];
/** Drop warmup points without a value (for chart rendering). */
export declare function plotPoints(series: TimeSeriesPoint[]): TimeSeriesPoint[];
export declare function typicalPrice(c: Candle): number;
export declare function smaValues(closes: number[], period: number): Array<number | undefined>;
export declare function populationStd(values: number[], mean: number): number;

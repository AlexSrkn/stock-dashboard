import { alignToCandles } from "./utils.js";
import { computeEma } from "./ema.js";
/** MACD (12, 26, 9): line, signal, histogram — aligned to candle index. */
export function computeMacd(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!candles.length) {
        return { macdLine: [], signalLine: [], histogram: [] };
    }
    const emaFast = computeEma(candles, fastPeriod);
    const emaSlow = computeEma(candles, slowPeriod);
    const macdRaw = candles.map((_, i) => {
        const f = emaFast[i]?.value;
        const s = emaSlow[i]?.value;
        if (f == null || s == null || !Number.isFinite(f) || !Number.isFinite(s))
            return undefined;
        return f - s;
    });
    const macdLine = alignToCandles(candles, macdRaw);
    const k = 2 / (signalPeriod + 1);
    const signalRaw = new Array(candles.length);
    let sum = 0;
    let signal;
    let macdCount = 0;
    for (let i = 0; i < candles.length; i++) {
        const m = macdRaw[i];
        if (m == null || !Number.isFinite(m))
            continue;
        macdCount += 1;
        if (macdCount < signalPeriod) {
            sum += m;
            continue;
        }
        if (macdCount === signalPeriod) {
            sum += m;
            signal = sum / signalPeriod;
            signalRaw[i] = signal;
            continue;
        }
        signal = m * k + signal * (1 - k);
        signalRaw[i] = signal;
    }
    const signalLine = alignToCandles(candles, signalRaw);
    const histogram = candles.map((c, i) => {
        const m = macdRaw[i];
        const s = signalRaw[i];
        if (m == null || s == null || !Number.isFinite(m) || !Number.isFinite(s)) {
            return { time: c.time };
        }
        return { time: c.time, value: m - s };
    });
    return { macdLine, signalLine, histogram };
}

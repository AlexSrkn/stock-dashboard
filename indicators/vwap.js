import { typicalPrice } from "./utils.js";
/** Session-cumulative VWAP (no daily reset). */
export function computeVwap(candles) {
    let cumPv = 0;
    let cumVol = 0;
    return candles.map((c) => {
        const vol = Number.isFinite(c.volume) ? Math.max(0, c.volume) : 0;
        if (vol > 0) {
            cumPv += typicalPrice(c) * vol;
            cumVol += vol;
        }
        if (cumVol <= 0)
            return { time: c.time };
        return { time: c.time, value: cumPv / cumVol };
    });
}

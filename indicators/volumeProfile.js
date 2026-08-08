import { typicalPrice } from "./utils.js";
function defaultBinSize(candles) {
    if (!candles.length)
        return 1;
    const prices = candles.flatMap((c) => [c.high, c.low]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = Math.max(max - min, 0.01);
    const auto = range / 50;
    if (auto >= 5)
        return Math.round(auto);
    if (auto >= 1)
        return 1;
    return 0.5;
}
/** Approximate volume-at-price distribution using typical-price bins. */
export function computeVolumeProfile(candles, options = {}) {
    if (!candles.length)
        return [];
    const binSize = options.binSize ?? defaultBinSize(candles);
    const bins = new Map();
    for (const c of candles) {
        const vol = Number.isFinite(c.volume) ? Math.max(0, c.volume) : 0;
        if (vol <= 0)
            continue;
        const tp = typicalPrice(c);
        const bucket = Math.round(tp / binSize) * binSize;
        const key = Math.round(bucket * 10000) / 10000;
        bins.set(key, (bins.get(key) ?? 0) + vol);
    }
    return [...bins.entries()]
        .map(([price, volume]) => ({ price, volume }))
        .sort((a, b) => a.price - b.price);
}

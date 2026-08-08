import type { SentimentClassification } from "./types.js";

export function clampNeg100to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-100, Math.min(100, n));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Percentile rank → 0–100 (average rank for ties). */
export function percentileScores(values: number[]): number[] {
  const n = values.length;
  if (!n) return [];
  const indexed = values.map((v, i) => ({ v: Number.isFinite(v) ? v : 0, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array<number>(n).fill(0);
  if (n === 1) {
    out[0] = 50;
    return out;
  }
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + (j - 1)) / 2;
    const score = (avgRank / (n - 1)) * 100;
    for (let k = i; k < j; k++) out[indexed[k].i] = score;
    i = j;
  }
  return out;
}

/** Map 0–100 percentile → −100…+100 (50 → 0). */
export function percentileToSigned(percentile0to100: number): number {
  return clampNeg100to100((percentile0to100 - 50) * 2);
}

/** Buyer share 0–1 → −100…+100 (0.5 → 0). */
export function buyerRatioToScore(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return clampNeg100to100((ratio - 0.5) * 200);
}

export function computeSentimentScore(parts: {
  netDollarFlowScore: number;
  buyerRatioScore: number;
  uniqueBuyersScore: number;
  netSharesScore: number;
}): number {
  const raw =
    parts.netDollarFlowScore * 0.4 +
    parts.buyerRatioScore * 0.25 +
    parts.uniqueBuyersScore * 0.2 +
    parts.netSharesScore * 0.15;
  return round1(clampNeg100to100(raw));
}

export function sentimentClassification(score: number): SentimentClassification {
  if (score >= 75) return "Strong Bullish";
  if (score >= 40) return "Bullish";
  if (score > -40) return "Neutral";
  if (score > -75) return "Bearish";
  return "Strong Bearish";
}

export function parseDateMs(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

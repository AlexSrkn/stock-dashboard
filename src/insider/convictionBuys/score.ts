import type { ConvictionLabel } from "./types.js";
import { MAX_CONVICTION_ROLE_WEIGHT } from "./roleWeights.js";

export function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

export function roleScoreFromWeight(weight: number): number {
  return clamp01to100((weight / MAX_CONVICTION_ROLE_WEIGHT) * 100);
}

/**
 * Ownership increase % → 0–100 score.
 * 0% → 0, ~10% → ~40, ~50% → ~70, 100%+ → ~90–100.
 */
export function ownershipIncreaseToScore(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return clamp01to100(20 + Math.log10(1 + pct) * 40);
}

/**
 * Repeat-buy behavior: blend purchase count and $ invested (already percentile-normalized inputs).
 */
export function repeatBuyComposite(countScore: number, amountScore: number): number {
  return clamp01to100(countScore * 0.45 + amountScore * 0.55);
}

export function computeConvictionScore(parts: {
  purchaseSizeScore: number;
  ownershipIncreaseScore: number;
  roleScore: number;
  repeatBuyScore: number;
}): number {
  const raw =
    parts.purchaseSizeScore * 0.4 +
    parts.ownershipIncreaseScore * 0.25 +
    parts.roleScore * 0.2 +
    parts.repeatBuyScore * 0.15;
  return round1(clamp01to100(raw));
}

export function convictionLabel(score: number): ConvictionLabel {
  if (score >= 85) return "Exceptional Conviction";
  if (score >= 70) return "High Conviction";
  if (score >= 40) return "Moderate Conviction";
  return "Low Conviction";
}

export function parseDateMs(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

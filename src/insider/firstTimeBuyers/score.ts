import type { FirstTimeBuyerClassification } from "./types.js";
import { MAX_FIRST_TIME_BUYER_ROLE_WEIGHT } from "./config.js";

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
  return clamp01to100((weight / MAX_FIRST_TIME_BUYER_ROLE_WEIGHT) * 100);
}

/**
 * Years since last buy → 0–100.
 * First-ever purchases score 100. ~3y → ~40, ~5y → ~60, 10y+ → ~100.
 */
export function yearsSinceLastBuyScore(
  years: number | null,
  firstEver: boolean
): number {
  if (firstEver) return 100;
  if (years == null || !Number.isFinite(years) || years <= 0) return 0;
  return clamp01to100(20 + Math.log10(1 + years) * 55);
}

export function computeFirstTimeBuyerScore(parts: {
  yearsScore: number;
  valueScore: number;
  roleScore: number;
  firstEverScore: number;
  sharesScore: number;
}): number {
  const raw =
    parts.yearsScore * 0.35 +
    parts.valueScore * 0.25 +
    parts.roleScore * 0.2 +
    parts.firstEverScore * 0.15 +
    parts.sharesScore * 0.05;
  return round1(clamp01to100(raw));
}

export function firstTimeBuyerClassification(score: number): FirstTimeBuyerClassification {
  if (score >= 85) return "First-Time High Conviction";
  if (score >= 70) return "Long-Term Return Buyer";
  if (score >= 40) return "Notable Return";
  return "Minor Purchase";
}

export function parseDateMs(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

export function yearsBetween(earlierMs: number, laterMs: number): number {
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs) || laterMs <= earlierMs) {
    return 0;
  }
  return (laterMs - earlierMs) / (365.25 * 86_400_000);
}

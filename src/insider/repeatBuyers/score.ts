import type { RepeatBuyerClassification } from "./types.js";

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

/**
 * Frequency: shorter average days between purchases → higher score.
 * Missing / single-buy intervals score near 0.
 */
export function frequencyScoreFromAvgDays(avgDays: number | null, invertedPercentile: number): number {
  if (avgDays == null || !Number.isFinite(avgDays) || avgDays <= 0) return 0;
  return clamp01to100(invertedPercentile);
}

export function computeRepeatBuyerScore(parts: {
  purchaseCountScore: number;
  streakScore: number;
  investmentScore: number;
  frequencyScore: number;
}): number {
  const raw =
    parts.purchaseCountScore * 0.4 +
    parts.streakScore * 0.25 +
    parts.investmentScore * 0.2 +
    parts.frequencyScore * 0.15;
  return round1(clamp01to100(raw));
}

export function repeatBuyerClassification(score: number): RepeatBuyerClassification {
  if (score >= 85) return "Serial Buyer";
  if (score >= 70) return "Strong Accumulator";
  if (score >= 40) return "Repeat Buyer";
  return "Occasional Buyer";
}

export function parseDateMs(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

/**
 * Current consecutive open-market buy streak.
 * Chronological P/S timeline: each P increments, each S resets to 0.
 * Result is the streak after the latest transaction (0 if latest is a sell).
 */
export function currentPurchaseStreak(
  codesChronological: ReadonlyArray<"P" | "S">
): number {
  let streak = 0;
  for (const code of codesChronological) {
    if (code === "P") streak += 1;
    else streak = 0;
  }
  return streak;
}

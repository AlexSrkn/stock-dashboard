import type { PoliticianRepeatBuyerClassification } from "./types.js";

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

export function computePoliticianRepeatBuyerScore(parts: {
  purchaseCountScore: number;
  streakScore: number;
  investmentScore: number;
  frequencyScore: number;
  recencyScore: number;
}): number {
  const raw =
    parts.purchaseCountScore * 0.35 +
    parts.streakScore * 0.25 +
    parts.investmentScore * 0.2 +
    parts.frequencyScore * 0.1 +
    parts.recencyScore * 0.1;
  return round1(clamp01to100(raw));
}

export function politicianRepeatBuyerClassification(
  score: number
): PoliticianRepeatBuyerClassification {
  if (score >= 85) return "High Conviction Buyer";
  if (score >= 70) return "Strong Accumulator";
  if (score >= 40) return "Repeat Buyer";
  return "Occasional Buyer";
}

export function parseDateMs(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const iso = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

/**
 * Current consecutive buy streak on a chronological buy/sell timeline.
 * Each buy increments; each sell resets to 0.
 */
export function currentPurchaseStreak(
  codesChronological: ReadonlyArray<"buy" | "sell">
): number {
  let streak = 0;
  for (const code of codesChronological) {
    if (code === "buy") streak += 1;
    else streak = 0;
  }
  return streak;
}

export function toIsoDate(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

import type { ConvictionClassification, ConvictionScoreComponents } from "./types.js";

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

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

/** Average percentile rank → 0–100 (ties share average rank). */
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
    while (j < n && indexed[j]!.v === indexed[i]!.v) j++;
    const avgRank = (i + (j - 1)) / 2;
    const score = (avgRank / (n - 1)) * 100;
    for (let k = i; k < j; k++) out[indexed[k]!.i] = score;
    i = j;
  }
  return out;
}

export function classifyConviction(score: number): ConvictionClassification {
  if (score >= 90) return "Exceptional Conviction";
  if (score >= 75) return "High Conviction";
  if (score >= 60) return "Strong Conviction";
  if (score >= 40) return "Moderate Conviction";
  return "Low Conviction";
}

/**
 * Breadth composite: 60% holders >1%, 40% holders >2% (as percentages 0–100).
 * Caller percentile-ranks this across the quarter.
 */
export function highConvictionBreadthMetric(
  pctAbove1: number,
  pctAbove2: number
): number {
  return pctAbove1 * 0.6 + pctAbove2 * 0.4;
}

/**
 * net_accumulation_ratio =
 * (increasing + 0.5×new − decreasing) / total_active
 * Mapped to 0–100 via tanh-ish soft scale around 0.
 */
export function accumulationComponentScore(input: {
  increasing: number;
  decreasing: number;
  newPositions: number;
  totalActive: number;
}): number {
  const total = Math.max(1, input.totalActive);
  const net =
    (input.increasing + 0.5 * input.newPositions - input.decreasing) / total;
  // net typically in [-1, 1]; center 50 at 0, ± near ±1
  return clamp01to100(50 + net * 50);
}

/**
 * Persistence from average streak + share of holders with multi-quarter streaks.
 */
export function persistenceComponentScore(input: {
  averageStreak: number;
  holders: number;
  streak2Plus: number;
  streak3Plus: number;
  streak4Plus: number;
}): number {
  const holders = Math.max(1, input.holders);
  const avgPart = clamp01to100((input.averageStreak / 4) * 100);
  const p2 = (input.streak2Plus / holders) * 100;
  const p3 = (input.streak3Plus / holders) * 100;
  const p4 = (input.streak4Plus / holders) * 100;
  return round1(clamp01to100(avgPart * 0.35 + p2 * 0.25 + p3 * 0.25 + p4 * 0.15));
}

export function computeInstitutionalConvictionScore(parts: {
  portfolioWeightScore: number;
  highConvictionBreadthScore: number;
  accumulationScore: number;
  persistenceScore: number;
}): { score: number; components: ConvictionScoreComponents } {
  const components: ConvictionScoreComponents = {
    portfolioWeightScore: round1(clamp01to100(parts.portfolioWeightScore)),
    highConvictionBreadthScore: round1(clamp01to100(parts.highConvictionBreadthScore)),
    accumulationScore: round1(clamp01to100(parts.accumulationScore)),
    persistenceScore: round1(clamp01to100(parts.persistenceScore)),
  };
  const score = round1(
    clamp01to100(
      components.portfolioWeightScore * 0.4 +
        components.highConvictionBreadthScore * 0.25 +
        components.accumulationScore * 0.2 +
        components.persistenceScore * 0.15
    )
  );
  return { score, components };
}

export function buildExplanation(input: {
  holders: number;
  medianWeight: number;
  increasing: number;
  holdersAbove2: number;
}): string {
  const medianPct = (input.medianWeight * 100).toFixed(1);
  return `${input.holders} institution${input.holders === 1 ? "" : "s"} hold the stock. Median portfolio weight: ${medianPct}%. ${input.increasing} institution${input.increasing === 1 ? "" : "s"} increased positions${input.holdersAbove2 > 0 ? `; ${input.holdersAbove2} allocate >2%` : ""}.`;
}

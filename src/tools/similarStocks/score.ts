import type { SimilarStocksComponentScores } from "./types.js";

export const SIMILAR_STOCKS_WEIGHTS: Record<keyof SimilarStocksComponentScores, number> = {
  institutional_profile: 0.4,
  institutional_holder_overlap: 0.2,
  institutional_activity: 0.15,
  insider_activity: 0.1,
  politician_activity: 0.05,
  signals: 0.1,
};

export const SIMILAR_STOCKS_METHODOLOGY =
  "Similarity ranks stocks by filing-based institutional profile, holder overlap, activity patterns, insider and politician behavior, and signal presence — without using price history, fundamentals multiples, or analyst ratings.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

/** Relative closeness of two numeric metrics on a 0–100 scale. */
export function numericSimilarity(a: number | null, b: number | null): number | null {
  if (!finite(a) || !finite(b)) return null;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return clampScore(100 * (1 - Math.abs(a - b) / denom));
}

/** Both same → 100; both null → null; one missing → 50; mismatch → 0. */
export function booleanSimilarity(a: boolean | null, b: boolean | null): number | null {
  if (a == null && b == null) return null;
  if (a == null || b == null) return 50;
  return a === b ? 100 : 0;
}

export function averageScores(scores: Array<number | null>): number | null {
  const vals = scores.filter((s): s is number => finite(s));
  if (!vals.length) return null;
  return clampScore(vals.reduce((s, n) => s + n, 0) / vals.length);
}

/** Min-max normalize a raw value into 0–100 within a peer set. */
export function minMaxNormalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return clampScore(value > 0 ? 100 : 0);
  }
  return clampScore(((value - min) / (max - min)) * 100);
}

export function weightedSimilarityScore(
  components: SimilarStocksComponentScores,
  weights: Record<keyof SimilarStocksComponentScores, number> = SIMILAR_STOCKS_WEIGHTS
): number | null {
  let weightSum = 0;
  let scoreSum = 0;
  for (const key of Object.keys(weights) as (keyof SimilarStocksComponentScores)[]) {
    const score = components[key];
    const weight = weights[key];
    if (!finite(score) || !finite(weight) || weight <= 0) continue;
    weightSum += weight;
    scoreSum += score * weight;
  }
  if (weightSum <= 0) return null;
  return clampScore(scoreSum / weightSum);
}

export interface ProfileMetrics {
  ownershipPct: number | null;
  holderCount: number | null;
  holderGrowthPct: number | null;
  discoveryScore: number | null;
  newHolderCount: number | null;
  exitedHolderCount: number | null;
  netHolderChange: number | null;
  ownershipChangePct: number | null;
  convictionScore: number | null;
  insiderSentiment: number | null;
  clusterBuying: boolean | null;
  heavySelling: boolean | null;
  repeatBuyers: boolean | null;
  politicianHeavyBuying: boolean | null;
  politicianHeavySelling: boolean | null;
  politicianRepeatBuyers: boolean | null;
  politicianFirstTimeBuyers: boolean | null;
  doubleSignal: boolean;
  tripleSignal: boolean;
  hiddenGem: boolean;
  conflictSignal: boolean;
  hasInsiderActivity: boolean;
  hasPoliticianActivity: boolean;
  hasActiveSignals: boolean;
}

export function scoreInstitutionalProfile(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): number | null {
  return averageScores([
    numericSimilarity(target.ownershipPct, candidate.ownershipPct),
    numericSimilarity(target.holderCount, candidate.holderCount),
    numericSimilarity(target.holderGrowthPct, candidate.holderGrowthPct),
    numericSimilarity(target.discoveryScore, candidate.discoveryScore),
  ]);
}

export function scoreInstitutionalActivity(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): number | null {
  return averageScores([
    numericSimilarity(target.newHolderCount, candidate.newHolderCount),
    numericSimilarity(target.exitedHolderCount, candidate.exitedHolderCount),
    numericSimilarity(target.netHolderChange, candidate.netHolderChange),
    numericSimilarity(target.ownershipChangePct, candidate.ownershipChangePct),
  ]);
}

export function scoreInsiderActivity(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): number | null {
  return averageScores([
    numericSimilarity(target.insiderSentiment, candidate.insiderSentiment),
    booleanSimilarity(target.clusterBuying, candidate.clusterBuying),
    booleanSimilarity(target.heavySelling, candidate.heavySelling),
    booleanSimilarity(target.repeatBuyers, candidate.repeatBuyers),
  ]);
}

export function scorePoliticianActivity(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): number | null {
  return averageScores([
    booleanSimilarity(target.politicianHeavyBuying, candidate.politicianHeavyBuying),
    booleanSimilarity(target.politicianHeavySelling, candidate.politicianHeavySelling),
    booleanSimilarity(target.politicianRepeatBuyers, candidate.politicianRepeatBuyers),
    booleanSimilarity(target.politicianFirstTimeBuyers, candidate.politicianFirstTimeBuyers),
  ]);
}

export function scoreSignalsActivity(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): number | null {
  return averageScores([
    booleanSimilarity(target.doubleSignal, candidate.doubleSignal),
    booleanSimilarity(target.tripleSignal, candidate.tripleSignal),
    booleanSimilarity(target.hiddenGem, candidate.hiddenGem),
    booleanSimilarity(target.conflictSignal, candidate.conflictSignal),
    numericSimilarity(target.convictionScore, candidate.convictionScore),
  ]);
}

export function scoreHolderOverlap(parts: {
  overlapPercentage: number;
  normalizedWeightedScore: number;
}): number {
  return clampScore(parts.overlapPercentage * 0.55 + parts.normalizedWeightedScore * 0.45);
}

export function buildMatchReasons(parts: {
  sharedHolderCount: number;
  discoverySimilarity: number | null;
  insiderSimilarity: number | null;
  politicianSimilarity: number | null;
  signalsSimilarity: number | null;
  activitySimilarity: number | null;
  matchingSignals: string[];
}): string[] {
  const reasons: string[] = [];
  if (parts.sharedHolderCount > 0) {
    reasons.push(
      `${parts.sharedHolderCount} shared institutional holder${parts.sharedHolderCount === 1 ? "" : "s"}`
    );
  }
  if (parts.discoverySimilarity != null && parts.discoverySimilarity >= 70) {
    reasons.push("Similar Institutional Discovery score");
  }
  if (parts.activitySimilarity != null && parts.activitySimilarity >= 70) {
    reasons.push("Similar institutional accumulation / position activity");
  }
  if (parts.insiderSimilarity != null && parts.insiderSimilarity >= 65) {
    reasons.push("Similar insider buying activity");
  }
  if (parts.politicianSimilarity != null && parts.politicianSimilarity >= 65) {
    reasons.push("Similar politician trading activity");
  }
  if (parts.matchingSignals.length) {
    reasons.push(`Matching signals: ${parts.matchingSignals.slice(0, 3).join(", ")}`);
  } else if (parts.signalsSimilarity != null && parts.signalsSimilarity >= 70) {
    reasons.push("Similar signal profile");
  }
  return reasons.slice(0, 4);
}

export function matchingSignalLabels(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): string[] {
  const out: string[] = [];
  if (target.doubleSignal && candidate.doubleSignal) out.push("Double Signal");
  if (target.tripleSignal && candidate.tripleSignal) out.push("Triple Signal");
  if (target.hiddenGem && candidate.hiddenGem) out.push("Hidden Gem");
  if (target.conflictSignal && candidate.conflictSignal) out.push("Conflict Signal");
  if (
    finite(target.convictionScore) &&
    finite(candidate.convictionScore) &&
    Math.abs(target.convictionScore! - candidate.convictionScore!) <= 15
  ) {
    out.push("Conviction Score");
  }
  return out;
}

export function matchingInsiderMetrics(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): string[] {
  const out: string[] = [];
  if (
    finite(target.insiderSentiment) &&
    finite(candidate.insiderSentiment) &&
    Math.abs(target.insiderSentiment! - candidate.insiderSentiment!) <= 15
  ) {
    out.push("Insider Sentiment");
  }
  if (target.clusterBuying && candidate.clusterBuying) out.push("Cluster Buying");
  if (target.heavySelling && candidate.heavySelling) out.push("Heavy Selling");
  if (target.repeatBuyers && candidate.repeatBuyers) out.push("Repeat Buyers");
  return out;
}

export function matchingPoliticianMetrics(
  target: ProfileMetrics,
  candidate: ProfileMetrics
): string[] {
  const out: string[] = [];
  if (target.politicianHeavyBuying && candidate.politicianHeavyBuying) out.push("Heavy Buying");
  if (target.politicianHeavySelling && candidate.politicianHeavySelling) {
    out.push("Heavy Selling");
  }
  if (target.politicianRepeatBuyers && candidate.politicianRepeatBuyers) {
    out.push("Repeat Buyers");
  }
  if (target.politicianFirstTimeBuyers && candidate.politicianFirstTimeBuyers) {
    out.push("First-Time Buyers");
  }
  return out;
}

import type { DiscoveryClassification, DiscoveryScoreComponents } from "./types.js";

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

/** Average percentile rank → 0–100 (ties share average rank). */
export function percentileScores(values: number[]): number[] {
  const n = values.length;
  if (!n) return [];
  const indexed = values.map((v, i) => ({ v: Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY, i }));
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

export function classifyDiscovery(score: number | null, insufficientData: boolean): DiscoveryClassification {
  if (insufficientData || score == null || !Number.isFinite(score)) return "Insufficient Data";
  if (score >= 90) return "Strong Institutional Discovery";
  if (score >= 75) return "Rapid Institutional Adoption";
  if (score >= 60) return "Institutional Discovery";
  if (score >= 40) return "Emerging Discovery";
  return "Early Interest";
}

export function holderGrowthPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous <= 0) return current > 0 ? 100 : null;
  return round2(((current - previous) / previous) * 100);
}

export function computeDiscoveryScore(parts: {
  holderGrowthScore: number;
  newHolderScore: number;
  growthStreakScore: number;
  ownershipGrowthScore: number;
}): { score: number; components: DiscoveryScoreComponents } {
  const components: DiscoveryScoreComponents = {
    holderGrowthScore: round1(clamp01to100(parts.holderGrowthScore)),
    newHolderScore: round1(clamp01to100(parts.newHolderScore)),
    growthStreakScore: round1(clamp01to100(parts.growthStreakScore)),
    ownershipGrowthScore: round1(clamp01to100(parts.ownershipGrowthScore)),
  };
  const score = round1(
    clamp01to100(
      components.holderGrowthScore * 0.35 +
        components.newHolderScore * 0.25 +
        components.growthStreakScore * 0.2 +
        components.ownershipGrowthScore * 0.2
    )
  );
  return { score, components };
}

/**
 * Length of the ascending holder-count run ending at `endIdx` (includes the
 * baseline quarter). Example: 18→31→52→79 → 4. Flat/decline → 0.
 */
export function growthStreakAt(
  holderCountsByQuarter: number[],
  endIdx: number
): number {
  if (endIdx <= 0 || endIdx >= holderCountsByQuarter.length) return 0;
  if ((holderCountsByQuarter[endIdx] ?? 0) <= (holderCountsByQuarter[endIdx - 1] ?? 0)) {
    return 0;
  }
  let start = endIdx;
  while (start >= 1 && (holderCountsByQuarter[start] ?? 0) > (holderCountsByQuarter[start - 1] ?? 0)) {
    start -= 1;
  }
  return endIdx - start + 1;
}

export function longestGrowthStreak(holderCountsByQuarter: number[]): number {
  let best = 0;
  for (let i = 1; i < holderCountsByQuarter.length; i++) {
    const streak = growthStreakAt(holderCountsByQuarter, i);
    if (streak > best) best = streak;
  }
  return best;
}

export function buildDiscoveryExplanation(input: {
  holderGrowthPercent: number | null;
  newHolderCount: number;
  growthStreak: number;
  ownershipChangePercent: number;
}): string {
  const growth =
    input.holderGrowthPercent == null
      ? "n/a holder growth"
      : `${input.holderGrowthPercent >= 0 ? "+" : ""}${input.holderGrowthPercent.toFixed(1)}% holder growth`;
  const own =
    `${input.ownershipChangePercent >= 0 ? "+" : ""}${input.ownershipChangePercent.toFixed(1)}% institutional ownership`;
  return `${growth}; ${input.newHolderCount} new institution${input.newHolderCount === 1 ? "" : "s"}; ${input.growthStreak} consecutive growth quarter${input.growthStreak === 1 ? "" : "s"}; ${own}.`;
}

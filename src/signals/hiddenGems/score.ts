import type { HiddenGemLabel, HiddenGemThresholds } from "./types.js";
import { DEFAULT_HIDDEN_GEM_THRESHOLDS } from "./types.js";

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

/** Map relative ownership growth (e.g. 0.15 = +15%) → 0–100. */
export function ownershipGrowthScore(growth: number): number {
  if (!Number.isFinite(growth) || growth <= 0) return 0;
  // 15% → ~40, 50% → ~75, 100%+ → 100
  return clamp01to100(40 + Math.log10(1 + growth * 10) * 40);
}

/** Map new-position count → 0–100. */
export function newPositionsScore(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return clamp01to100((count / 15) * 100);
}

/** Map net accumulation intensity (net / previous shares) → 0–100. */
export function accumulationScore(netShares: number, previousShares: number): number {
  if (!Number.isFinite(netShares) || netShares <= 0) return 0;
  if (!previousShares || previousShares <= 0) return clamp01to100(netShares > 0 ? 70 : 0);
  const ratio = netShares / previousShares;
  return clamp01to100(ratio * 200);
}

/**
 * Conviction from buyer portfolio weights (fractions 0–1).
 * Combines average, median, and >2% allocation count.
 */
export function computeConvictionScore(input: {
  avgWeight: number;
  medianWeight: number;
  highConvictionCount: number;
  buyerCount: number;
}): number {
  const avgPart = clamp01to100((input.avgWeight / 0.05) * 50);
  const medianPart = clamp01to100((input.medianWeight / 0.03) * 30);
  const highPart =
    input.buyerCount > 0
      ? clamp01to100((input.highConvictionCount / input.buyerCount) * 100) * 0.2
      : 0;
  return round1(clamp01to100(avgPart * 0.5 + medianPart * 0.3 + highPart));
}

/** Lower ownership → higher scarcity bonus (0% → 100, 35% → ~0). */
export function scarcityScore(ownershipPct: number, maxOwnershipPct = 35): number {
  if (!Number.isFinite(ownershipPct)) return 0;
  if (ownershipPct >= maxOwnershipPct) return 0;
  return clamp01to100(((maxOwnershipPct - ownershipPct) / maxOwnershipPct) * 100);
}

export function computeHiddenGemScore(parts: {
  ownershipGrowth: number;
  newPositionsCount: number;
  netShares: number;
  previousShares: number;
  convictionScore: number;
  institutionalOwnership: number;
  maxOwnershipPct?: number;
}): number {
  const growth = ownershipGrowthScore(parts.ownershipGrowth);
  const news = newPositionsScore(parts.newPositionsCount);
  const accum = accumulationScore(parts.netShares, parts.previousShares);
  const conviction = clamp01to100(parts.convictionScore);
  const scarcity = scarcityScore(
    parts.institutionalOwnership,
    parts.maxOwnershipPct ?? DEFAULT_HIDDEN_GEM_THRESHOLDS.maxInstitutionalOwnershipPct
  );

  return round1(
    growth * 0.3 + news * 0.25 + accum * 0.2 + conviction * 0.15 + scarcity * 0.1
  );
}

export function labelForScore(score: number): HiddenGemLabel {
  if (score >= 86) return "Institutional Discovery";
  if (score >= 71) return "Strong Accumulation";
  if (score >= 41) return "Hidden Gem";
  return "Emerging";
}

export function qualifiesAsHiddenGem(
  row: {
    institutionalOwnership: number;
    ownershipGrowth: number;
    increasingPositionsCount: number;
    netSharesAccumulated: number;
    marketCapUsd: number | null;
  },
  thresholds: HiddenGemThresholds = DEFAULT_HIDDEN_GEM_THRESHOLDS
): boolean {
  if (row.institutionalOwnership >= thresholds.maxInstitutionalOwnershipPct) return false;
  if (row.ownershipGrowth <= thresholds.minOwnershipGrowth) return false;
  if (row.increasingPositionsCount < thresholds.minIncreasingPositions) return false;
  if (thresholds.requirePositiveNet && row.netSharesAccumulated <= 0) return false;
  const mcap = Number(row.marketCapUsd);
  if (!Number.isFinite(mcap) || mcap < thresholds.minMarketCapUsd) return false;
  return true;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}


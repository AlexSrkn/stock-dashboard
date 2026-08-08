import type { OwnershipHistoryCategory } from "./types.js";

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

/**
 * Ownership Expansion Score — how quickly institutional ownership is rising.
 * Inputs: ownership % growth, holder growth, new entries, consistency.
 */
export function ownershipExpansionScore(input: {
  ownershipChange: number;
  holderChange: number;
  newInstitutions: number;
  consecutiveGrowthQuarters: number;
}): number {
  const ownPart = clamp01to100(input.ownershipChange * 12);
  const holderPart = clamp01to100(input.holderChange * 8);
  const newPart = clamp01to100(input.newInstitutions * 6);
  const consistency = clamp01to100(input.consecutiveGrowthQuarters * 20);
  return round1(ownPart * 0.4 + holderPart * 0.25 + newPart * 0.2 + consistency * 0.15);
}

/**
 * Institutional Adoption Score — becoming widely owned.
 */
export function institutionalAdoptionScore(input: {
  currentHolderCount: number;
  newInstitutions: number;
  consecutiveGrowthQuarters: number;
}): number {
  const breadth = clamp01to100((input.currentHolderCount / 25) * 100);
  const additions = clamp01to100(input.newInstitutions * 8);
  const streak = clamp01to100(input.consecutiveGrowthQuarters * 22);
  return round1(breadth * 0.45 + additions * 0.35 + streak * 0.2);
}

/**
 * Early Discovery — still relatively low ownership, adoption accelerating.
 * Soft-boosted by insider buys / politician buys when present.
 */
export function earlyDiscoveryScore(input: {
  currentOwnership: number;
  ownershipChange: number;
  newInstitutions: number;
  consecutiveGrowthQuarters: number;
  insiderBuyCount: number;
  politicianBuyCount: number;
}): number {
  if (input.currentOwnership >= 40 || input.ownershipChange <= 0) return 0;
  const scarcity = clamp01to100(((35 - Math.min(input.currentOwnership, 35)) / 35) * 100);
  const accel = clamp01to100(input.ownershipChange * 15 + input.newInstitutions * 5);
  const streak = clamp01to100(input.consecutiveGrowthQuarters * 18);
  const alt = clamp01to100(input.insiderBuyCount * 4 + input.politicianBuyCount * 8);
  return round1(scarcity * 0.35 + accel * 0.35 + streak * 0.2 + alt * 0.1);
}

/** Decline score — losing institutional support. */
export function ownershipDeclineScore(input: {
  ownershipChange: number;
  holderChange: number;
  exitedInstitutions: number;
}): number {
  if (input.ownershipChange >= 0 && input.holderChange >= 0) return 0;
  const ownDrop = clamp01to100(Math.abs(Math.min(input.ownershipChange, 0)) * 12);
  const holderDrop = clamp01to100(Math.abs(Math.min(input.holderChange, 0)) * 8);
  const exits = clamp01to100(input.exitedInstitutions * 6);
  return round1(ownDrop * 0.45 + holderDrop * 0.3 + exits * 0.25);
}

export function pickCategory(scores: {
  expansion: number;
  adoption: number;
  early: number;
  decline: number;
  ownershipChange: number;
}): OwnershipHistoryCategory {
  if (scores.decline >= 40 && scores.ownershipChange < 0) {
    if (scores.decline >= scores.expansion && scores.decline >= scores.adoption && scores.decline >= scores.early) {
      return "ownership_decliner";
    }
  }
  const ranked: Array<{ cat: OwnershipHistoryCategory; score: number }> = [
    { cat: "early_discovery", score: scores.early },
    { cat: "ownership_expansion", score: scores.expansion },
    { cat: "institutional_adoption", score: scores.adoption },
  ];
  ranked.sort((a, b) => b.score - a.score);
  if (ranked[0].score <= 0 && scores.ownershipChange < 0) return "ownership_decliner";
  return ranked[0].cat;
}

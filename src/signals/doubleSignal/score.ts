/** Normalize a count to 0–1 with a soft cap. */
function countScore(count: number, cap: number): number {
  if (count <= 0) return 0;
  return Math.min(1, count / cap);
}

/** Log-scaled USD value to 0–1 (reference max in USD). */
function valueScore(usd: number, logMax: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.min(1, Math.log10(Math.max(usd, 1)) / logMax);
}

/**
 * Score 0–100 from institutional + insider buying activity.
 * Rewards multiple buyers on both sides, total position/purchase value, and breadth.
 */
export function computeSignalStrengthScore(input: {
  institutionCount: number;
  insiderPurchaseCount: number;
  totalInstitutionalValueUsd: number;
  totalInsiderPurchaseUsd: number;
}): number {
  const instCount = countScore(input.institutionCount, 8);
  const insiderCount = countScore(input.insiderPurchaseCount, 5);
  const instValue = valueScore(input.totalInstitutionalValueUsd, 9);
  const insiderValue = valueScore(input.totalInsiderPurchaseUsd, 7);

  const multiInstBonus = input.institutionCount >= 2 ? 0.08 : 0;
  const multiInsiderBonus = input.insiderPurchaseCount >= 2 ? 0.08 : 0;

  const raw =
    instCount * 0.2 +
    insiderCount * 0.2 +
    instValue * 0.22 +
    insiderValue * 0.22 +
    multiInstBonus +
    multiInsiderBonus;

  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

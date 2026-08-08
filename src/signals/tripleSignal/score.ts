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
 * Score 0–100 from institutional + insider + politician buying.
 * Same structure as Double Signal, with an added politician leg.
 */
export function computeTripleSignalStrengthScore(input: {
  institutionCount: number;
  insiderPurchaseCount: number;
  politicianPurchaseCount: number;
  totalInstitutionalValueUsd: number;
  totalInsiderPurchaseUsd: number;
  totalPoliticianPurchaseUsd: number;
}): number {
  const instCount = countScore(input.institutionCount, 8);
  const insiderCount = countScore(input.insiderPurchaseCount, 5);
  const polCount = countScore(input.politicianPurchaseCount, 4);
  const instValue = valueScore(input.totalInstitutionalValueUsd, 9);
  const insiderValue = valueScore(input.totalInsiderPurchaseUsd, 7);
  const polValue = valueScore(input.totalPoliticianPurchaseUsd, 6);

  const multiInstBonus = input.institutionCount >= 2 ? 0.05 : 0;
  const multiInsiderBonus = input.insiderPurchaseCount >= 2 ? 0.05 : 0;
  const multiPolBonus = input.politicianPurchaseCount >= 2 ? 0.05 : 0;

  const raw =
    instCount * 0.16 +
    insiderCount * 0.16 +
    polCount * 0.16 +
    instValue * 0.16 +
    insiderValue * 0.14 +
    polValue * 0.12 +
    multiInstBonus +
    multiInsiderBonus +
    multiPolBonus;

  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

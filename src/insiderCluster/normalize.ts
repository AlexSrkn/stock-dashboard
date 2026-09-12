/** Min-max scale to [0, 100]. Single-value universe → 50 (neutral). */
export function minMaxTo100(values: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (!values.size) return out;

  const nums = [...values.values()].filter((v) => Number.isFinite(v));
  if (!nums.length) return out;
  if (nums.length === 1) {
    const [onlyKey] = values.keys();
    out.set(onlyKey, 50);
    return out;
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;

  for (const [key, value] of values) {
    if (!Number.isFinite(value)) {
      out.set(key, 0);
      continue;
    }
    out.set(key, Math.round(((value - min) / span) * 10_000) / 100);
  }
  return out;
}

export function capScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

/** Absolute buyer-count strength (not universe-relative). */
export function absoluteBuyerCountScore(buyerCount: number): number {
  const n = Math.max(0, Math.floor(Number(buyerCount) || 0));
  if (n <= 0) return 0;
  if (n === 1) return 22;
  if (n === 2) return 48;
  if (n === 3) return 72;
  if (n === 4) return 88;
  return 100;
}

/** Absolute role-weight sum strength (CEO+CFO+Director ≈ 2.35). */
export function absoluteRoleWeightScore(roleWeightSum: number): number {
  const sum = Math.max(0, Number(roleWeightSum) || 0);
  return capScore((sum / 2.5) * 100);
}

/** Absolute log dollar buy-value strength. */
export function absoluteBuyValueScore(totalBuyValueUsd: number): number {
  const usd = Math.max(0, Number(totalBuyValueUsd) || 0);
  if (usd <= 0) return 0;
  // $1k→20, $10k→40, $100k→60, $1M→80, $10M+→100
  const log = Math.log10(usd);
  return capScore(((log - 2) / 5) * 100);
}

/** Absolute cluster density: unique buyers per day of span. */
export function absoluteDensityScore(buyerCount: number, spanDays: number): number {
  const density = buyerCount / Math.max(spanDays, 1);
  if (density >= 0.5) return 100;
  if (density >= 0.25) return 80;
  if (density >= 0.1) return 60;
  if (density >= 0.05) return 42;
  if (density >= 0.025) return 28;
  return 18;
}

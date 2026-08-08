function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function medianAbs(values: number[]): number {
  const abs = values.map((v) => Math.abs(v)).filter((v) => v > 0).sort((a, b) => a - b);
  if (!abs.length) return 1;
  const mid = Math.floor(abs.length / 2);
  return abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2;
}

/** Z-score with clip to [-3, 3], scaled to [-1, 1]. */
export function zScoreNormalizeMap(values: Map<string, number>): Map<string, number> {
  const entries = [...values.entries()].filter(([, v]) => Number.isFinite(v));
  const out = new Map<string, number>();
  if (!entries.length) return out;

  const nums = entries.map(([, v]) => v);
  const avg = mean(nums);
  const sd = stdDev(nums, avg) || 1;

  for (const [ticker, value] of entries) {
    const z = (value - avg) / sd;
    const clipped = Math.max(-3, Math.min(3, z));
    out.set(ticker, clipped / 3);
  }
  return out;
}

export function convictionScoreFromFinal(
  finalScore: number,
  universeFinalScores: number[]
): number {
  const scale = medianAbs(universeFinalScores) || 1;
  const centered = 50 + 50 * Math.tanh(finalScore / scale);
  return Math.max(0, Math.min(100, Math.round(centered * 100) / 100));
}

export function signNonZero(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

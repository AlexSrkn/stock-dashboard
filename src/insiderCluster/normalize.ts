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

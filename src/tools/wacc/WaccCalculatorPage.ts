/** Presentational helpers for Tools → WACC Calculator. */

export function formatWaccNull(n: number | null | undefined, suffix = ""): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${n}${suffix}`;
}

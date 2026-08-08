/** Presentational helpers for Tools → EPV Calculator. */

export function formatEpvNull(n: number | null | undefined, suffix = ""): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${n}${suffix}`;
}

export function epvMethodology(): string {
  return "EPV estimates the value of a company based on sustainable normalized earnings without assuming future growth.";
}

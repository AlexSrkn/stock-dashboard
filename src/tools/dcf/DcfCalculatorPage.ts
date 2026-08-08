/** Presentational helpers for Tools → DCF Calculator (mirrors StockComparisonPage pattern). */

export function formatDcfNull(n: number | null | undefined, suffix = ""): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${n}${suffix}`;
}

export function dcfDisclaimer(): string {
  return "DCF valuation is an estimate based on user-selected assumptions and is not investment advice.";
}

/** Presentational helpers for Stocks → Stock Comparison. */

export function formatCompareNull(n: number | null | undefined, suffix = ""): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${n}${suffix}`;
}

export function higherActivitySide(
  a: number | null | undefined,
  b: number | null | undefined
): "A" | "B" | "tie" | "none" {
  const aOk = a != null && Number.isFinite(Number(a));
  const bOk = b != null && Number.isFinite(Number(b));
  if (!aOk && !bOk) return "none";
  if (aOk && !bOk) return "A";
  if (!aOk && bOk) return "B";
  const av = Number(a);
  const bv = Number(b);
  if (av === bv) return "tie";
  return av > bv ? "A" : "B";
}

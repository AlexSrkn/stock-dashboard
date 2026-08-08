/** Presentational helpers for Signals → Institutional Discovery. */

export function discoveryBadgeClass(classification: string | null | undefined): string {
  const c = String(classification || "").toLowerCase();
  if (c.includes("strong")) return "discovery-badge discovery-badge--strong";
  if (c.includes("rapid")) return "discovery-badge discovery-badge--rapid";
  if (c.includes("institutional discovery")) return "discovery-badge discovery-badge--mid";
  if (c.includes("emerging")) return "discovery-badge discovery-badge--emerging";
  if (c.includes("insufficient")) return "discovery-badge discovery-badge--insufficient";
  return "discovery-badge discovery-badge--early";
}

export function formatGrowthPct(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

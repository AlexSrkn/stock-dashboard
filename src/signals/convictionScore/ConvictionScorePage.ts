/** Presentational helpers for the Signals → Conviction Score page. */

export function convictionLabelClass(classification: string | null | undefined): string {
  const c = String(classification || "").toLowerCase();
  if (c.includes("exceptional")) return "conviction-score-badge conviction-score-badge--exceptional";
  if (c.includes("high")) return "conviction-score-badge conviction-score-badge--high";
  if (c.includes("strong")) return "conviction-score-badge conviction-score-badge--strong";
  if (c.includes("moderate")) return "conviction-score-badge conviction-score-badge--moderate";
  return "conviction-score-badge conviction-score-badge--low";
}

export function formatWeightPct(fraction: number | null | undefined): string {
  const v = Number(fraction);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

export function formatAccumulationRatio(ratio: number | null | undefined): string {
  const v = Number(ratio);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

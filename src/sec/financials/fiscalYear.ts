import type { XbrlFactObservation } from "./types.js";
import {
  classifyDuration,
  durationDays,
  is10KForm,
  observationEnd,
  parseIsoDate,
} from "./periodUtils.js";

/**
 * Fiscal year for an annual (10-K) period end.
 *
 * Comparative / restated facts in a later 10-K often carry that later filing's
 * `fy` (e.g. FY2023 figures inside the FY2025 10-K tagged fy=2025). Using the
 * latest observation's `fy` therefore mislabels historical years.
 *
 * Prefer the earliest-filed annual-duration observation for this period end —
 * that is the original 10-K that reported the year — and use its `fy`.
 * Falls back to earliest-filed 10-K fact at the end when no annual duration exists
 * (e.g. balance-sheet-only).
 */
export function resolveAnnualFiscalYear(
  observations: XbrlFactObservation[],
  periodEnd?: string | null
): number | null {
  const end = periodEnd ? parseIsoDate(periodEnd) : null;
  const atEnd = observations.filter((obs) => {
    if (!is10KForm(obs.form)) return false;
    if (obs.fy == null || !Number.isFinite(Number(obs.fy))) return false;
    if (end) return observationEnd(obs) === end;
    return true;
  });
  if (!atEnd.length) return null;

  const annualDuration = atEnd.filter(
    (obs) => classifyDuration(durationDays(obs)) === "annual_ytd"
  );
  // Prefer true annual-duration facts; otherwise earliest 10-K fact at this end
  // (covers balance-sheet-only and facts that omit `start`).
  const pool = annualDuration.length ? annualDuration : atEnd;

  const original = [...pool].sort((a, b) => {
    const filedCmp = String(a.filed ?? "").localeCompare(String(b.filed ?? ""));
    if (filedCmp !== 0) return filedCmp;
    // Stable tie-break: lower fy is usually the native year when filed dates match.
    return Number(a.fy) - Number(b.fy);
  })[0];

  if (!original) return null;
  const fy = Number(original.fy);
  return Number.isFinite(fy) ? fy : null;
}

/**
 * Optional SEC `frame` hint (e.g. CY2023) when original fy metadata is missing.
 * Does not replace filing fy when present — calendar frame ≠ fiscal year for all issuers.
 */
export function fiscalYearFromFrame(frame: string | null | undefined): number | null {
  if (!frame) return null;
  const m = String(frame).match(/CY(\d{4})/i);
  if (!m) return null;
  const fy = Number(m[1]);
  return Number.isFinite(fy) ? fy : null;
}

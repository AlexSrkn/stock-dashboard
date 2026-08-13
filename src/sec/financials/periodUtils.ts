import type { XbrlFactObservation } from "./types.js";

export const QUARTER_FP_ORDER = ["Q1", "Q2", "Q3"] as const;
export type NormalizedFiscalPeriod = "FY" | "Q1" | "Q2" | "Q3" | "Q4";

export type DurationBucket = "quarter" | "h1_ytd" | "nine_m_ytd" | "annual_ytd" | "unknown";

export function observationEnd(obs: XbrlFactObservation): string | null {
  const end = obs.end ?? obs.instant;
  return end ? String(end).slice(0, 10) : null;
}

export function is10KForm(form: string | null | undefined): boolean {
  const f = String(form ?? "").toUpperCase();
  return f === "10-K" || f === "10-K/A";
}

export function is10QForm(form: string | null | undefined): boolean {
  const f = String(form ?? "").toUpperCase();
  return f === "10-Q" || f === "10-Q/A";
}

export function is8KForm(form: string | null | undefined): boolean {
  const f = String(form ?? "").toUpperCase();
  return f === "8-K" || f === "8-K/A";
}

/** 10-K periods are always FY regardless of SEC fp field (avoids Q1 mislabels). */
export function normalizeFiscalPeriod(
  obs: XbrlFactObservation,
  scope: "annual" | "quarterly"
): NormalizedFiscalPeriod | null {
  if (scope === "annual") {
    return is10KForm(obs.form) ? "FY" : null;
  }
  if (!is10QForm(obs.form)) return null;
  const fp = String(obs.fp ?? "").toUpperCase();
  if (fp === "Q1" || fp === "Q2" || fp === "Q3") return fp;
  return null;
}

export function durationDays(obs: XbrlFactObservation): number | null {
  if (!obs.start || !obs.end) return null;
  const start = Date.parse(String(obs.start).slice(0, 10));
  const end = Date.parse(String(obs.end).slice(0, 10));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function classifyDuration(days: number | null): DurationBucket {
  if (days == null) return "unknown";
  if (days >= 80 && days <= 98) return "quarter";
  if (days >= 170 && days <= 190) return "h1_ytd";
  if (days >= 260 && days <= 280) return "nine_m_ytd";
  if (days >= 350 && days <= 380) return "annual_ytd";
  return "unknown";
}

/** Display label for a duration bucket (not the SEC fiscal-period tag). */
export function durationBucketLabel(bucket: DurationBucket | null | undefined): string | null {
  switch (bucket) {
    case "quarter":
      return null; // use fiscal period (Q1/Q2/Q3) instead
    case "h1_ytd":
      return "6M YTD";
    case "nine_m_ytd":
      return "9M YTD";
    case "annual_ytd":
      return "FY";
    default:
      return null;
  }
}

export function isYtdDurationBucket(bucket: DurationBucket | null | undefined): boolean {
  return bucket === "h1_ytd" || bucket === "nine_m_ytd" || bucket === "annual_ytd";
}

export function isInstantObservation(obs: XbrlFactObservation): boolean {
  if (obs.start) return false;
  const days = durationDays(obs);
  if (days != null) return false;
  return Boolean(obs.end ?? obs.instant);
}

export function periodDedupKey(
  fy: number,
  fp: NormalizedFiscalPeriod,
  scope: "annual" | "quarterly"
): string {
  return `${scope}|${fy}|${fp}`;
}

export function periodCanonicalKey(
  fy: number,
  fp: NormalizedFiscalPeriod,
  end: string
): string {
  return `${fy}|${fp}|${end}`;
}

/** @deprecated Use periodCanonicalKey(fy, fp, end). */
export function periodRowKey(
  fp: NormalizedFiscalPeriod,
  scope: "annual" | "quarterly",
  end: string
): string {
  return `${scope}|${fp}|${end}`;
}

export function parseIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function isValidFilingDate(periodEnd: string, filedDate: string): boolean {
  return filedDate >= periodEnd;
}

export function hasItem202(items: string | null | undefined): boolean {
  return String(items ?? "")
    .split(",")
    .map((s) => s.trim())
    .some((item) => item === "2.02" || item.startsWith("2.02"));
}

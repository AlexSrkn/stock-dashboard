import type { ComparePeriod } from "./types.js";

export function parseComparePeriod(raw: string | null): ComparePeriod {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "2q" || v === "2") return "2q";
  if (v === "4q" || v === "4") return "4q";
  if (v === "12m" || v === "365d" || v === "1y" || v === "year") return "12m";
  if (v === "all" || v === "all-available") return "all";
  return "latest";
}

/** Calendar lookback start (ISO date) for Form 4 / PTR filtering. */
export function periodStartDate(period: ComparePeriod, now = new Date()): string | null {
  if (period === "all") return null;
  const d = new Date(now);
  if (period === "latest") {
    d.setUTCDate(d.getUTCDate() - 90);
  } else if (period === "2q") {
    d.setUTCDate(d.getUTCDate() - 180);
  } else if (period === "4q" || period === "12m") {
    d.setUTCDate(d.getUTCDate() - 365);
  }
  return d.toISOString().slice(0, 10);
}

export function institutionalChartQuarters(period: ComparePeriod): number {
  if (period === "latest") return 2;
  if (period === "2q") return 4;
  if (period === "4q" || period === "12m") return 8;
  return 24;
}

export function doubleTripleWindowDays(period: ComparePeriod): 90 | 180 | 365 {
  if (period === "latest") return 90;
  if (period === "2q") return 180;
  return 365;
}

/**
 * Presentational helper for Politicians First-Time Buyers.
 * Live UI is in `app.js` (`#politicians-first-time-buyers`).
 */
import type { PoliticianFirstTimeBuyersPayload } from "./types.js";

export interface PoliticianFirstTimeBuyersPageProps {
  payload: PoliticianFirstTimeBuyersPayload;
}

export function formatYearsSinceLastBuy(
  firstRecorded: boolean,
  years: number | null
): string {
  if (firstRecorded) return "First recorded";
  if (years == null || !Number.isFinite(years)) return "—";
  return `${years.toFixed(1)}y`;
}

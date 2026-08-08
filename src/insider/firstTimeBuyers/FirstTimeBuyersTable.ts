import type { FirstTimeBuyerRow, FirstTimeBuyersPayload } from "./types.js";

/**
 * Presentational helper for First-Time Buyers.
 * Live UI is in `app.js` (vanilla).
 */
export interface FirstTimeBuyersTableProps {
  payload: FirstTimeBuyersPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
}

export function formatFirstTimeScore(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function mapFirstTimeBuyerRowsForUi(payload: FirstTimeBuyersPayload): Array<
  FirstTimeBuyerRow & { rank: number }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.rows.map((row, idx) => ({ ...row, rank: offset + idx + 1 }));
}

export function firstTimeBuyerLabelClass(label: string): string {
  if (label === "First-Time High Conviction") {
    return "first-time-buyer-label first-time-buyer-label--high";
  }
  if (label === "Long-Term Return Buyer") {
    return "first-time-buyer-label first-time-buyer-label--long";
  }
  if (label === "Notable Return") {
    return "first-time-buyer-label first-time-buyer-label--notable";
  }
  return "first-time-buyer-label first-time-buyer-label--minor";
}

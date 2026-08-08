import type { RepeatBuyerRow, RepeatBuyersPayload } from "./types.js";

/**
 * Presentational helper for Repeat Buyers.
 * Live UI is in `app.js` (vanilla); documents the React-shaped props API.
 */
export interface RepeatBuyersTableProps {
  payload: RepeatBuyersPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
}

export function formatRepeatScore(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function mapRepeatBuyerRowsForUi(payload: RepeatBuyersPayload): Array<
  RepeatBuyerRow & { rank: number }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.rows.map((row, idx) => ({ ...row, rank: offset + idx + 1 }));
}

export function repeatBuyerLabelClass(label: string): string {
  if (label === "Serial Buyer") return "repeat-buyer-label repeat-buyer-label--serial";
  if (label === "Strong Accumulator") return "repeat-buyer-label repeat-buyer-label--strong";
  if (label === "Repeat Buyer") return "repeat-buyer-label repeat-buyer-label--repeat";
  return "repeat-buyer-label repeat-buyer-label--occasional";
}

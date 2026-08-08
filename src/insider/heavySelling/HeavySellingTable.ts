import type { HeavySellingPayload, HeavySellingRow } from "./types.js";

/**
 * Presentational helper for Heavy Selling.
 * Live UI is in `app.js` (vanilla).
 */
export interface HeavySellingTableProps {
  payload: HeavySellingPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
}

export function formatHeavyScore(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function mapHeavySellingRowsForUi(payload: HeavySellingPayload): Array<
  HeavySellingRow & { rank: number }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.rows.map((row, idx) => ({ ...row, rank: offset + idx + 1 }));
}

export function heavySellingLabelClass(label: string): string {
  if (label === "Extreme Insider Selling") {
    return "heavy-selling-label heavy-selling-label--extreme";
  }
  if (label === "Heavy Selling") return "heavy-selling-label heavy-selling-label--heavy";
  if (label === "Elevated Selling") return "heavy-selling-label heavy-selling-label--elevated";
  return "heavy-selling-label heavy-selling-label--normal";
}

import type { ConvictionBuyRow, ConvictionBuysPayload } from "./types.js";

/**
 * Presentational helper for Conviction Buys.
 * Live UI is in `app.js` (vanilla); this documents the React-shaped props API
 * used by ConvictionBuysPage.
 */
export interface ConvictionBuysTableProps {
  payload: ConvictionBuysPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
}

export function formatConvictionScore(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function formatOwnershipIncrease(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function mapConvictionBuyRowsForUi(payload: ConvictionBuysPayload): Array<
  ConvictionBuyRow & { rank: number }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.rows.map((row, idx) => ({ ...row, rank: offset + idx + 1 }));
}

export function convictionLabelClass(label: string): string {
  if (label === "Exceptional Conviction") return "conviction-buy-label conviction-buy-label--exceptional";
  if (label === "High Conviction") return "conviction-buy-label conviction-buy-label--high";
  if (label === "Moderate Conviction") return "conviction-buy-label conviction-buy-label--moderate";
  return "conviction-buy-label conviction-buy-label--low";
}

import type { HiddenGemRow, HiddenGemsPayload } from "./types.js";

/**
 * Presentational helper for Hidden Gems table.
 * Live UI is in `app.js` (vanilla); this documents the React-shaped props API.
 */
export interface HiddenGemsTableProps {
  payload: HiddenGemsPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
}

export function formatOwnershipPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatOwnershipGrowth(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatGemScore(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function mapHiddenGemRowsForUi(payload: HiddenGemsPayload): Array<
  HiddenGemRow & { rank: number }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.signals.map((row, idx) => ({ ...row, rank: offset + idx + 1 }));
}


import type { OwnershipHistoryPayload, OwnershipHistoryRow } from "./types.js";
import { OWNERSHIP_HISTORY_CATEGORY_LABELS } from "./types.js";

/**
 * Presentational helper for Ownership History.
 * Live UI is in `app.js` (vanilla); this documents the React-shaped props API.
 */
export interface OwnershipHistoryTableProps {
  payload: OwnershipHistoryPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;
  onExport?: () => void;
}

export function formatOwnershipChange(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  const fixed = n.toFixed(digits);
  return n > 0 ? `+${fixed}` : fixed;
}

export function categoryLabel(category: string): string {
  return (
    OWNERSHIP_HISTORY_CATEGORY_LABELS[category as keyof typeof OWNERSHIP_HISTORY_CATEGORY_LABELS] ||
    category
  );
}

export function mapOwnershipHistoryRowsForUi(payload: OwnershipHistoryPayload): Array<
  OwnershipHistoryRow & { rank: number; categoryLabel: string }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.stocks.map((row, idx) => ({
    ...row,
    rank: offset + idx + 1,
    categoryLabel: categoryLabel(row.category),
  }));
}


import type { RepeatBuyersPayload } from "./types.js";
import {
  formatRepeatScore,
  mapRepeatBuyerRowsForUi,
  repeatBuyerLabelClass,
  type RepeatBuyersTableProps,
} from "./RepeatBuyersTable.js";

/**
 * Presentational page contract for Repeat Buyers.
 * Mounted in the Insiders hub via `app.js` (`#insider-repeat-buyers-hub`).
 */
export interface RepeatBuyersPageProps extends RepeatBuyersTableProps {
  loading?: boolean;
  emptyMessage?: string;
}

export function repeatBuyersPageTitle(): string {
  return "Repeat Buyers";
}

export function repeatBuyersPageSubtitle(): string {
  return "Insiders who repeatedly buy open-market shares of the same company — streaks, frequency, and capital deployed.";
}

export function summarizeRepeatBuyersForCards(payload: RepeatBuyersPayload | null) {
  const s = payload?.summary;
  return {
    active: s ? String(s.activeRepeatBuyers) : "—",
    longestStreak: s ? String(s.longestPurchaseStreak) : "—",
    largestInvestment: s?.largestTotalInvestment ?? null,
    averageScore: s ? formatRepeatScore(s.averageRepeatBuyerScore) : "—",
  };
}

export { formatRepeatScore, mapRepeatBuyerRowsForUi, repeatBuyerLabelClass };

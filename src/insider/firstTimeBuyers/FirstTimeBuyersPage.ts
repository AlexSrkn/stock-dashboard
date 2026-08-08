import type { FirstTimeBuyersPayload } from "./types.js";
import {
  firstTimeBuyerLabelClass,
  formatFirstTimeScore,
  mapFirstTimeBuyerRowsForUi,
  type FirstTimeBuyersTableProps,
} from "./FirstTimeBuyersTable.js";

/**
 * Presentational page contract for First-Time Buyers.
 * Mounted in the Insiders hub via `app.js` (`#insider-first-time-buyers-hub`).
 */
export interface FirstTimeBuyersPageProps extends FirstTimeBuyersTableProps {
  loading?: boolean;
  emptyMessage?: string;
}

export function firstTimeBuyersPageTitle(): string {
  return "First-Time Buyers";
}

export function firstTimeBuyersPageSubtitle(): string {
  return "Insiders making a first open-market buy — or returning after years with no purchases.";
}

export function summarizeFirstTimeBuyersForCards(payload: FirstTimeBuyersPayload | null) {
  const s = payload?.summary;
  return {
    firstEver: s ? String(s.firstEverBuyers) : "—",
    avgYears: s?.averageYearsSinceLastBuy != null ? String(s.averageYearsSinceLastBuy) : "—",
    highest: s?.highestConviction
      ? `${s.highestConviction.ticker} · ${formatFirstTimeScore(s.highestConviction.score)}`
      : "—",
    capital: s?.totalCapitalInvested ?? null,
  };
}

export { firstTimeBuyerLabelClass, formatFirstTimeScore, mapFirstTimeBuyerRowsForUi };

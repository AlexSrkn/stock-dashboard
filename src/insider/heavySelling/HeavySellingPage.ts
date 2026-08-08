import type { HeavySellingPayload } from "./types.js";
import {
  formatHeavyScore,
  heavySellingLabelClass,
  mapHeavySellingRowsForUi,
  type HeavySellingTableProps,
} from "./HeavySellingTable.js";

/**
 * Presentational page contract for Heavy Selling.
 * Mounted in the Insiders hub via `app.js` (`#insider-heavy-selling-hub`).
 */
export interface HeavySellingPageProps extends HeavySellingTableProps {
  loading?: boolean;
  emptyMessage?: string;
}

export function heavySellingPageTitle(): string {
  return "Heavy Selling";
}

export function heavySellingPageSubtitle(): string {
  return "Stocks with significant open-market Form 4 selling — clusters, executives, and large sales.";
}

export function summarizeHeavySellingForCards(payload: HeavySellingPayload | null) {
  const s = payload?.summary;
  return {
    largest: s?.largestInsiderSale
      ? `${s.largestInsiderSale.ticker}`
      : "—",
    clusters: s ? String(s.clusterSellingEvents) : "—",
    executives: s ? String(s.executiveSellers) : "—",
    totalSold: s?.totalInsiderSelling ?? null,
  };
}

export { formatHeavyScore, heavySellingLabelClass, mapHeavySellingRowsForUi };

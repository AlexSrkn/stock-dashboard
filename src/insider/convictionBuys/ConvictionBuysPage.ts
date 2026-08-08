import type { ConvictionBuysPayload } from "./types.js";
import {
  convictionLabelClass,
  formatConvictionScore,
  formatOwnershipIncrease,
  mapConvictionBuyRowsForUi,
  type ConvictionBuysTableProps,
} from "./ConvictionBuysTable.js";

/**
 * Presentational page contract for Conviction Buys.
 * Mounted in the Insiders hub via `app.js` (`#insider-conviction-buys-hub`).
 */
export interface ConvictionBuysPageProps extends ConvictionBuysTableProps {
  loading?: boolean;
  emptyMessage?: string;
}

export function convictionBuysPageTitle(): string {
  return "Conviction Buys";
}

export function convictionBuysPageSubtitle(): string {
  return "Open-market Form 4 purchases ranked by conviction — size, ownership increase, role, and repeat buying.";
}

export function summarizeConvictionBuysForCards(payload: ConvictionBuysPayload | null) {
  const s = payload?.summary;
  return {
    highest: s?.highestConvictionTrade
      ? `${s.highestConvictionTrade.ticker} · ${formatConvictionScore(s.highestConvictionTrade.convictionScore)}`
      : "—",
    average: s ? formatConvictionScore(s.averageConvictionScore) : "—",
    highCount: s ? String(s.highConvictionBuys) : "—",
    capital: s?.totalCapitalDeployed ?? null,
  };
}

export {
  convictionLabelClass,
  formatConvictionScore,
  formatOwnershipIncrease,
  mapConvictionBuyRowsForUi,
};

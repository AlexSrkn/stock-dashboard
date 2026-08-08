import type { HolderOverlapPayload, HolderOverlapRow } from "./types.js";

/**
 * Presentational helper mirroring the Holder Overlap table contract.
 * The live UI is implemented in `app.js` (vanilla); this documents the
 * React-shaped props API for future surfaces.
 */
export interface HolderOverlapTableProps {
  payload: HolderOverlapPayload;
  onSelectTicker?: (ticker: string) => void;
  onPageChange?: (page: number) => void;
}

export function formatOverlapPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function formatPortfolioWeight(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function mapOverlapRowsForUi(payload: HolderOverlapPayload): Array<
  HolderOverlapRow & { rank: number }
> {
  const offset = (payload.page - 1) * payload.pageSize;
  return payload.stocks.map((row, idx) => ({ ...row, rank: offset + idx + 1 }));
}

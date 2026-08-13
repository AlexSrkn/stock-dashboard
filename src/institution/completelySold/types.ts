export interface CompletelySoldPositionRow {
  /** Aggregated exit row keyed by ticker across all tracked institutions. */
  ticker: string;
  companyName: string | null;
  sector: string | null;
  /** Sum of prior-quarter 13F market values for this ticker across exiting institutions. */
  previousPositionValueUsd: number;
  /** Sum of prior-quarter share counts across exiting institutions. */
  previousShares: number;
  /** Number of institutions that fully exited this ticker. */
  institutionsExiting: number;
  /** Quarters represented among the underlying institution exits. */
  quarters: string[];
  currentPosition: "Sold";
}

export interface CompletelySoldSummary {
  totalStocksSold: number;
  institutionsReporting: number;
  uniqueStocksSold: number;
  totalValueExitedUsd: number;
}

export interface CompletelySoldPayload {
  computedAt: string;
  quarters: string[];
  sectors: string[];
  summary: CompletelySoldSummary;
  positions: CompletelySoldPositionRow[];
}

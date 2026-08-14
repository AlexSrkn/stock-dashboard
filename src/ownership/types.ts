export interface OwnershipQueryMeta {
  ticker: string;
  cusips: string[];
  issuerHint: string | null;
  currentQuarter: string;
  previousQuarter: string | null;
  /** Number of curated institutional filers tracked in institutional-ciks.ts */
  trackedFundCount: number;
  /** Shares outstanding used as denominator for % Outstanding (ownership cache / SEC). */
  impliedSharesOutstanding: number | null;
  /** Live share price when a provider is wired; ownership Value uses 13F reported value first. */
  stockPrice: number | null;
  currency: string;
}

export interface FundHoldingAggregate {
  fundName: string;
  /** Padded SEC CIK when the filer is in the curated institutional list. */
  filerCik?: string;
  shares: number;
  /** 13F reported market value (USD); live mark only if filing value is missing. */
  valueUsd: number | null;
  /** Fund shares as % of company implied shares outstanding (0–100). */
  pctOutstanding: number | null;
  /** Common-stock shares in the prior quarter (latest filing per filer). */
  previousShares?: number | null;
  /** QoQ % change in common-stock shares: (current − previous) / previous × 100. */
  sharesChangePct?: number | null;
  /** Dollar value of the QoQ share-count change at 13F quarter-end price (USD). */
  valueChangeUsd?: number | null;
}

export interface TopHoldersResponse {
  meta: OwnershipQueryMeta;
  holders: FundHoldingAggregate[];
}

export interface OwnershipChangeRow {
  fundName: string;
  filerCik?: string;
  currentShares: number;
  currentValueUsd: number | null;
  previousShares: number;
  previousValueUsd: number | null;
  sharesChange: number;
  valueChangeUsd: number | null;
  sharesChangePct: number | null;
  currentPctOutstanding: number | null;
  previousPctOutstanding: number | null;
}

export interface OwnershipChangesResponse {
  meta: OwnershipQueryMeta;
  changes: OwnershipChangeRow[];
}

export interface PositionEventRow {
  fundName: string;
  filerCik?: string;
  shares: number;
  valueUsd: number | null;
  pctOutstanding: number | null;
  previousShares?: number;
  previousValueUsd?: number | null;
}

export interface NewPositionsResponse {
  meta: OwnershipQueryMeta;
  positions: PositionEventRow[];
}

export interface SoldOutResponse {
  meta: OwnershipQueryMeta;
  positions: PositionEventRow[];
}

export interface OptionPositionRow {
  fundName: string;
  filerCik?: string;
  /** Option contracts / shares reported on 13F. */
  contracts: number;
  /** Filing market value (USD) from 13F info table. */
  valueUsd: number | null;
}

export interface InstitutionalOptionsResponse {
  meta: OwnershipQueryMeta;
  calls: OptionPositionRow[];
  puts: OptionPositionRow[];
}

export interface OwnershipQueryOptions {
  limit?: number;
  /** Max quarters of 13F history for chart events (default 24). */
  quarters?: number;
}

export interface InstitutionalChartEventRow {
  fundName: string;
  filerCik?: string;
  quarter: string;
  filingDate: string;
  side: "buy" | "sell";
  sharesChange: number;
  currentShares: number;
  previousShares: number;
  eventType: "add" | "trim" | "new" | "sold-out";
}

export interface InstitutionalChartEventsResponse {
  meta: Pick<OwnershipQueryMeta, "ticker" | "cusips" | "trackedFundCount"> & {
    quartersLoaded: number;
  };
  events: InstitutionalChartEventRow[];
}

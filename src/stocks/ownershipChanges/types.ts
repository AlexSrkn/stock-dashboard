export type OwnershipChangeDirection = "increases" | "decreases";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface OwnershipChangeRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
  marketCapUsd: number | null;
  currentOwnershipPct: number | null;
  previousOwnershipPct: number | null;
  changePct: number;
  institutionCount: number;
  totalInstitutionalShares: number;
  currentQuarter: string;
  previousQuarter: string;
}

export interface OwnershipChangesSummary {
  topIncrease: { ticker: string; companyName: string | null; changePct: number } | null;
  topDecrease: { ticker: string; companyName: string | null; changePct: number } | null;
  stockCount: number;
  averageChangePct: number | null;
}

export interface OwnershipChangesPayload {
  computedAt: string;
  quarter: string;
  previousQuarter: string;
  /** Preferred default when client asks for "latest" (skips sparse in-progress quarters). */
  defaultQuarter: string;
  direction: OwnershipChangeDirection;
  summary: OwnershipChangesSummary;
  sectors: string[];
  exchanges: string[];
  quarters: string[];
  page: number;
  pageSize: number;
  total: number;
  stocks: OwnershipChangeRow[];
}

export interface OwnershipChangesCachePayload {
  computedAt: string;
  quarters: string[];
  /** Latest mostly complete quarter — used when UI/API request "latest". */
  defaultQuarter: string | null;
  sectors: string[];
  exchanges: string[];
  /** Quarter -> rows comparing that quarter to the immediately prior quarter. */
  byQuarter: Record<string, OwnershipChangeRow[]>;
}

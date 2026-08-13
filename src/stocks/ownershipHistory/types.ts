export type OwnershipHistoryCategory =
  | "ownership_expansion"
  | "institutional_adoption"
  | "early_discovery"
  | "ownership_decliner";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export const OWNERSHIP_HISTORY_CATEGORY_LABELS: Record<OwnershipHistoryCategory, string> = {
  ownership_expansion: "Ownership Expansion",
  institutional_adoption: "Institutional Adoption",
  early_discovery: "Early Institutional Discovery",
  ownership_decliner: "Ownership Decliner",
};

export interface OwnershipHistoryRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  currentInstitutionalOwnership: number;
  previousInstitutionalOwnership: number;
  ownershipChange: number;
  currentHolderCount: number;
  previousHolderCount: number;
  holderChange: number;
  newInstitutions: number;
  exitedInstitutions: number;
  totalInstitutionalValueUsd: number;
  netInstitutionalShares: number;
  consecutiveGrowthQuarters: number;
  ownershipExpansionScore: number;
  institutionalAdoptionScore: number;
  earlyDiscoveryScore: number;
  ownershipDeclineScore: number;
  category: OwnershipHistoryCategory;
  /** Soft enrichment from Form 4 / congressional buys in the lookback window. */
  insiderBuyCount: number;
  insiderSellCount: number;
  politicianBuyCount: number;
  currentQuarter: string;
  previousQuarter: string;
}

export interface OwnershipHistoryHighlight {
  ticker: string;
  companyName: string | null;
  value: number;
  label: string;
}

export interface OwnershipHistorySummary {
  fastestGrowth: OwnershipHistoryHighlight | null;
  biggestHolderIncrease: OwnershipHistoryHighlight | null;
  biggestDecline: OwnershipHistoryHighlight | null;
  newDiscoveries: OwnershipHistoryHighlight | null;
  stockCount: number;
  currentQuarter: string;
  previousQuarter: string | null;
}

export interface OwnershipHistoryCachePayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  sectors: string[];
  byQuarter: Record<string, OwnershipHistoryRow[]>;
}

export interface OwnershipHistoryPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  sectors: string[];
  summary: OwnershipHistorySummary;
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  sortDir: "asc" | "desc";
  category: OwnershipHistoryCategory | "";
  stocks: OwnershipHistoryRow[];
}


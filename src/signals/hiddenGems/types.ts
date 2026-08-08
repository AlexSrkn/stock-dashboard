export type HiddenGemLabel =
  | "Emerging"
  | "Hidden Gem"
  | "Strong Accumulation"
  | "Institutional Discovery";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

/** Configurable qualification thresholds (also used as API filter defaults). */
export interface HiddenGemThresholds {
  maxInstitutionalOwnershipPct: number;
  minOwnershipGrowth: number;
  minIncreasingPositions: number;
  minMarketCapUsd: number;
  requirePositiveNet: boolean;
}

export const DEFAULT_HIDDEN_GEM_THRESHOLDS: HiddenGemThresholds = {
  maxInstitutionalOwnershipPct: 35,
  minOwnershipGrowth: 0.15,
  minIncreasingPositions: 5,
  minMarketCapUsd: 100_000_000,
  requirePositiveNet: true,
};

export interface HiddenGemRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  institutionalOwnership: number;
  previousInstitutionalOwnership: number;
  ownershipGrowth: number;
  ownershipChangePctPoints: number;
  institutionsCount: number;
  newPositionsCount: number;
  increasingPositionsCount: number;
  netSharesAccumulated: number;
  avgBuyerPortfolioWeight: number;
  medianBuyerPortfolioWeight: number;
  highConvictionBuyers: number;
  convictionScore: number;
  hiddenGemScore: number;
  label: HiddenGemLabel;
  quarter: string;
  previousQuarter: string;
}

export interface HiddenGemSummary {
  totalGems: number;
  emerging: number;
  hiddenGem: number;
  strongAccumulation: number;
  institutionalDiscovery: number;
  currentQuarter: string;
  previousQuarter: string | null;
}

export interface HiddenGemsCachePayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  thresholds: HiddenGemThresholds;
  summary: HiddenGemSummary;
  sectors: string[];
  signals: HiddenGemRow[];
}

export interface HiddenGemsPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  thresholds: HiddenGemThresholds;
  summary: HiddenGemSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  sortDir: "asc" | "desc";
  signals: HiddenGemRow[];
}


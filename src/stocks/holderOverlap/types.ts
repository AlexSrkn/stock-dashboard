export type HolderOverlapMode = "popularity" | "conviction" | "weighted";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface HolderOverlapRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  overlapCount: number;
  overlapPercentage: number;
  weightedScore: number;
  convictionScore: number;
  marketCapUsd: number | null;
}

export interface HolderOverlapInstitution {
  cik: string;
  name: string;
  institutionType: string | null;
  shares: number;
  valueUsd: number;
  portfolioWeight: number;
}

export interface HolderOverlapInsider {
  name: string;
  title: string | null;
  transactionDate: string | null;
  transactionValue: number;
  shares: number;
}

export interface HolderOverlapPolitician {
  name: string;
  chamber: string | null;
  transactionDate: string | null;
  estimatedValueUsd: number;
  transactionCategory: string;
}

export interface HolderOverlapSummary {
  targetTicker: string;
  targetCompanyName: string | null;
  quarter: string;
  holderCount: number;
  overlapStockCount: number;
}

export interface HolderOverlapPayload {
  computedAt: string;
  summary: HolderOverlapSummary;
  mode: HolderOverlapMode;
  page: number;
  pageSize: number;
  total: number;
  stocks: HolderOverlapRow[];
  institutions: HolderOverlapInstitution[];
  insiders: HolderOverlapInsider[];
  politicians: HolderOverlapPolitician[];
  sectors: string[];
  institutionTypes: string[];
}

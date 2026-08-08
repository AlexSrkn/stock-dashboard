export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export type ConvictionClassification =
  | "Low Conviction"
  | "Moderate Conviction"
  | "Strong Conviction"
  | "High Conviction"
  | "Exceptional Conviction";

export interface ConvictionScoreThresholds {
  /** Minimum institutional holders required for a scored row. */
  minHolders: number;
  highConvictionWeight1Pct: number;
  highConvictionWeight2Pct: number;
  highConvictionWeight5Pct: number;
  highConvictionWeight10Pct: number;
}

export const DEFAULT_CONVICTION_THRESHOLDS: ConvictionScoreThresholds = {
  minHolders: 5,
  highConvictionWeight1Pct: 0.01,
  highConvictionWeight2Pct: 0.02,
  highConvictionWeight5Pct: 0.05,
  highConvictionWeight10Pct: 0.1,
};

export interface ConvictionScoreComponents {
  portfolioWeightScore: number;
  highConvictionBreadthScore: number;
  accumulationScore: number;
  persistenceScore: number;
}

export interface ConvictionHistoryPoint {
  quarter: string;
  convictionScore: number | null;
  classification: ConvictionClassification | null;
  medianPortfolioWeight: number;
  institutionalHolders: number;
  accumulationRatio: number;
  insufficientData: boolean;
}

export interface ConvictionScoreRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  convictionScore: number | null;
  classification: ConvictionClassification | null;
  insufficientData: boolean;
  institutionalHolders: number;
  medianPortfolioWeight: number;
  averagePortfolioWeight: number;
  holdersAbove1Percent: number;
  holdersAbove2Percent: number;
  holdersAbove5Percent: number;
  holdersAbove10Percent: number;
  convictionBreadth: number;
  percentageAbove2Percent: number;
  percentageAbove5Percent: number;
  institutionsIncreasing: number;
  institutionsDecreasing: number;
  institutionsMaintaining: number;
  newPositions: number;
  exitedPositions: number;
  accumulationRatio: number;
  averageAccumulationStreak: number;
  maxAccumulationStreak: number;
  institutionsAccumulating2PlusQuarters: number;
  institutionsAccumulating3PlusQuarters: number;
  institutionsAccumulating4PlusQuarters: number;
  scoreComponents: ConvictionScoreComponents | null;
  explanation: string;
  quarter: string;
  previousQuarter: string | null;
  history: ConvictionHistoryPoint[];
}

export interface ConvictionScoreSummary {
  highestConviction: {
    ticker: string;
    companyName: string | null;
    score: number;
  } | null;
  averageConviction: number | null;
  highConvictionStocks: number;
  exceptionalConvictionStocks: number;
  currentQuarter: string;
  previousQuarter: string | null;
}

export interface ConvictionScoreCachePayload {
  version: 1;
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  thresholds: ConvictionScoreThresholds;
  summary: ConvictionScoreSummary;
  sectors: string[];
  signals: ConvictionScoreRow[];
}

export interface ConvictionScorePayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  thresholds: ConvictionScoreThresholds;
  summary: ConvictionScoreSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  sortDir: "asc" | "desc";
  signals: ConvictionScoreRow[];
}

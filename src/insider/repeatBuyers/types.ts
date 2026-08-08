export type RepeatBuyerClassification =
  | "Occasional Buyer"
  | "Repeat Buyer"
  | "Strong Accumulator"
  | "Serial Buyer";

export type RepeatBuyerSortKey =
  | "repeatBuyerScore"
  | "purchaseCount"
  | "purchaseStreak"
  | "totalInvested"
  | "latestPurchase"
  | "purchasesLast12Months"
  | "ticker";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface RawOpenMarketTrade {
  id: number;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  insiderName: string;
  insiderTitle: string | null;
  filingDate: string | null;
  transactionDate: string | null;
  transactionCode: string;
  shares: number;
  pricePerShare: number | null;
  valueUsd: number;
}

export interface RepeatBuyerRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  insiderName: string;
  title: string | null;
  role: string;
  purchaseCount: number;
  purchasesLast12Months: number;
  purchasesLast24Months: number;
  purchaseStreak: number;
  totalShares: number;
  totalInvested: number;
  averagePurchaseSize: number;
  averageDaysBetweenPurchases: number | null;
  firstPurchase: string | null;
  latestPurchase: string | null;
  repeatBuyerScore: number;
  classification: RepeatBuyerClassification;
  purchaseCountScore: number;
  streakScore: number;
  investmentScore: number;
  frequencyScore: number;
}

export interface RepeatBuyersSummary {
  activeRepeatBuyers: number;
  longestPurchaseStreak: number;
  largestTotalInvestment: number;
  averageRepeatBuyerScore: number;
}

export interface RepeatBuyersCachePayload {
  version: 1;
  computedAt: string;
  rows: RepeatBuyerRow[];
  sectors: string[];
}

export interface RepeatBuyersPayload {
  computedAt: string;
  summary: RepeatBuyersSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: RepeatBuyerSortKey;
  sortDir: "asc" | "desc";
  rows: RepeatBuyerRow[];
}

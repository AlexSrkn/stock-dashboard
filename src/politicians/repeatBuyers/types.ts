export type PoliticianRepeatBuyerClassification =
  | "Occasional Buyer"
  | "Repeat Buyer"
  | "Strong Accumulator"
  | "High Conviction Buyer";

export type PoliticianRepeatBuyerSortKey =
  | "repeatBuyerScore"
  | "purchaseCount"
  | "purchaseStreak"
  | "estimatedTotalInvested"
  | "latestPurchase"
  | "purchasesLast12Months"
  | "ticker";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface PoliticianRepeatBuyerRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  politicianKey: string;
  politicianName: string;
  party: string | null;
  state: string | null;
  chamber: "house" | "senate";
  purchaseCount: number;
  purchasesLast3Months: number;
  purchasesLast6Months: number;
  purchasesLast12Months: number;
  purchasesLast24Months: number;
  purchaseStreak: number;
  totalMinInvested: number;
  totalMaxInvested: number;
  estimatedTotalInvested: number;
  averagePurchaseSize: number;
  averageDaysBetweenPurchases: number | null;
  firstPurchase: string | null;
  latestPurchase: string | null;
  repeatBuyerScore: number;
  classification: PoliticianRepeatBuyerClassification;
}

export interface PoliticianRepeatBuyersSummary {
  activeRepeatBuyers: number;
  longestPurchaseStreak: number;
  largestEstimatedInvestment: {
    ticker: string;
    politicianName: string;
    value: number;
  } | null;
  averageRepeatBuyerScore: number | null;
}

export interface PoliticianRepeatBuyersCachePayload {
  version: 1;
  computedAt: string;
  fetchedAt: string | null;
  rows: PoliticianRepeatBuyerRow[];
  sectors: string[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
  parties: string[];
}

export interface PoliticianRepeatBuyersPayload {
  computedAt: string;
  fetchedAt: string | null;
  available: boolean;
  unavailableReason: string | null;
  summary: PoliticianRepeatBuyersSummary;
  sectors: string[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
  parties: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: PoliticianRepeatBuyerSortKey;
  sortDir: "asc" | "desc";
  rows: PoliticianRepeatBuyerRow[];
}

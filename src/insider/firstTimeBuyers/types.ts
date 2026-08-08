export type FirstTimeBuyerClassification =
  | "Minor Purchase"
  | "Notable Return"
  | "Long-Term Return Buyer"
  | "First-Time High Conviction";

export type FirstTimeBuyerSortKey =
  | "firstTimeBuyerScore"
  | "yearsSinceLastBuy"
  | "purchaseValue"
  | "filingDate"
  | "transactionDate"
  | "ticker";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface RawOpenMarketBuy {
  id: number;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  insiderName: string;
  insiderTitle: string | null;
  filingDate: string | null;
  transactionDate: string | null;
  shares: number;
  pricePerShare: number | null;
  valueUsd: number;
}

export interface FirstTimeBuyerRow {
  id: number;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  insiderName: string;
  title: string | null;
  role: string;
  filingDate: string | null;
  transactionDate: string | null;
  shares: number;
  pricePerShare: number | null;
  purchaseValue: number;
  yearsSinceLastBuy: number | null;
  previousBuyDate: string | null;
  historicalPurchaseCount: number;
  firstEverPurchase: boolean;
  firstTimeBuyerScore: number;
  classification: FirstTimeBuyerClassification;
  yearsScore: number;
  valueScore: number;
  roleScore: number;
  firstEverScore: number;
  sharesScore: number;
  roleWeight: number;
}

export interface FirstTimeBuyersSummary {
  firstEverBuyers: number;
  averageYearsSinceLastBuy: number | null;
  highestConviction: {
    ticker: string;
    insiderName: string;
    score: number;
    purchaseValue: number;
  } | null;
  totalCapitalInvested: number;
}

export interface FirstTimeBuyersCachePayload {
  version: 1;
  computedAt: string;
  minYearsThreshold: number;
  rows: FirstTimeBuyerRow[];
  sectors: string[];
}

export interface FirstTimeBuyersPayload {
  computedAt: string;
  minYearsThreshold: number;
  summary: FirstTimeBuyersSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: FirstTimeBuyerSortKey;
  sortDir: "asc" | "desc";
  rows: FirstTimeBuyerRow[];
}

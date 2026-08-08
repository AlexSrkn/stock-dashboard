export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export type PoliticianFirstTimeBuyerSortKey =
  | "transactionDate"
  | "yearsSinceLastBuy"
  | "estimatedPurchaseValue"
  | "politicianName"
  | "ticker";

export interface PoliticianFirstTimeBuyerRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  politicianKey: string;
  politicianName: string;
  party: string | null;
  state: string | null;
  chamber: "house" | "senate";
  transactionDate: string | null;
  disclosureDate: string | null;
  estimatedPurchaseValue: number;
  firstRecordedPurchase: boolean;
  previousBuyDate: string | null;
  yearsSinceLastBuy: number | null;
  previousBuyCount: number;
  totalHistoricalBuyCount: number;
  firstPurchaseDate: string | null;
  latestPurchaseDate: string | null;
}

export interface PoliticianFirstTimeBuyersSummary {
  firstRecordedBuyers: number;
  returningBuyers: number;
  averageYearsSincePreviousPurchase: number | null;
  totalEstimatedPurchases: number;
}

export interface PoliticianFirstTimeBuyersCachePayload {
  version: 1;
  computedAt: string;
  fetchedAt: string | null;
  minYearsThreshold: number;
  rows: PoliticianFirstTimeBuyerRow[];
  sectors: string[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
  parties: string[];
}

export interface PoliticianFirstTimeBuyersPayload {
  computedAt: string;
  fetchedAt: string | null;
  minYearsThreshold: number;
  available: boolean;
  unavailableReason: string | null;
  summary: PoliticianFirstTimeBuyersSummary;
  sectors: string[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
  parties: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: PoliticianFirstTimeBuyerSortKey;
  sortDir: "asc" | "desc";
  rows: PoliticianFirstTimeBuyerRow[];
}

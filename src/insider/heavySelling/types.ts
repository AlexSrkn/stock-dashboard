export type HeavySellingClassification =
  | "Normal Selling"
  | "Elevated Selling"
  | "Heavy Selling"
  | "Extreme Insider Selling";

export type HeavySellingSortKey =
  | "heavySellingScore"
  | "valueSold"
  | "uniqueSellers"
  | "executiveSellers"
  | "largestSale"
  | "latestSaleDate"
  | "ticker";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface RawOpenMarketSell {
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

export interface RoleSaleCounts {
  CEO: number;
  Founder: number;
  Chairman: number;
  CFO: number;
  President: number;
  Officer: number;
  Director: number;
}

export interface HeavySellingRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  totalSellTransactions: number;
  uniqueSellers: number;
  executiveSellers: number;
  sharesSold: number;
  valueSold: number;
  averageSaleSize: number;
  largestSale: number;
  largestSaleInsider: string | null;
  largestSaleDate: string | null;
  netInsiderSelling: number;
  clusterSelling: boolean;
  clusterSize: number;
  clusterValueSold: number;
  clusterSharesSold: number;
  clusterExecutiveSellers: number;
  roleSaleCounts: RoleSaleCounts;
  latestSaleDate: string | null;
  heavySellingScore: number;
  classification: HeavySellingClassification;
}

export interface HeavySellingSummary {
  largestInsiderSale: {
    ticker: string;
    value: number;
    insiderName: string | null;
  } | null;
  clusterSellingEvents: number;
  executiveSellers: number;
  totalInsiderSelling: number;
}

export interface HeavySellingCachePayload {
  version: 1;
  computedAt: string;
  clusterWindowDays: number;
  rows: HeavySellingRow[];
  sectors: string[];
}

export interface HeavySellingPayload {
  computedAt: string;
  clusterWindowDays: number;
  summary: HeavySellingSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: HeavySellingSortKey;
  sortDir: "asc" | "desc";
  rows: HeavySellingRow[];
}

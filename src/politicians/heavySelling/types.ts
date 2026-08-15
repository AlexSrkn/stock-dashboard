export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export type PoliticianHeavySellingSortKey =
  | "estimatedTotalSold"
  | "uniqueSellers"
  | "sellTransactions"
  | "largestSale"
  | "latestSale"
  | "ticker"
  | "currentConsecutiveSales"
  | "multipleSellers";

export interface PoliticianHeavySellingSeller {
  politicianKey: string;
  politicianName: string;
  party: string | null;
  state: string | null;
  chamber: "house" | "senate";
  sellCount: number;
  estimatedSold: number;
  currentConsecutiveSales: number;
  previousConsecutiveSales: number;
  firstSellDate: string | null;
  latestSellDate: string | null;
}

export interface PoliticianHeavySellingRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  sellTransactions: number;
  uniqueSellers: number;
  estimatedTotalSold: number;
  largestSale: number;
  averageSale: number;
  currentConsecutiveSales: number;
  previousConsecutiveSales: number;
  multipleSellers: boolean;
  multipleSellerCount: number;
  democratSellers: number;
  republicanSellers: number;
  independentSellers: number;
  senatorSellers: number;
  representativeSellers: number;
  salesLast30Days: number;
  salesLast90Days: number;
  salesLast12Months: number;
  firstSale: string | null;
  latestSale: string | null;
  sellers: PoliticianHeavySellingSeller[];
}

export interface PoliticianLargestSaleRow {
  ticker: string;
  companyName: string | null;
  politicianKey: string;
  politicianName: string;
  party: string | null;
  state: string | null;
  chamber: "house" | "senate";
  transactionDate: string | null;
  estimatedSaleValue: number;
}

export interface PoliticianHeavySellingSummary {
  largestEstimatedSale: {
    ticker: string;
    companyName: string | null;
    politicianName: string;
    value: number;
  } | null;
  stocksWithMultipleSellers: number;
  activePoliticianSellers: number;
  totalEstimatedValueSold: number;
}

export interface PoliticianHeavySellingCachePayload {
  version: 1;
  computedAt: string;
  fetchedAt: string | null;
  multipleSellersWindowDays: number;
  multipleSellersMin: number;
  rows: PoliticianHeavySellingRow[];
  largestSales: PoliticianLargestSaleRow[];
  sectors: string[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
  parties: string[];
}

export interface PoliticianHeavySellingPayload {
  computedAt: string;
  fetchedAt: string | null;
  multipleSellersWindowDays: number;
  multipleSellersMin: number;
  available: boolean;
  unavailableReason: string | null;
  summary: PoliticianHeavySellingSummary;
  sectors: string[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
  parties: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: PoliticianHeavySellingSortKey;
  sortDir: "asc" | "desc";
  rows: PoliticianHeavySellingRow[];
  largestSales: PoliticianLargestSaleRow[];
}

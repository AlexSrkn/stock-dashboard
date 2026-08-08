export type SentimentClassification =
  | "Strong Bullish"
  | "Bullish"
  | "Neutral"
  | "Bearish"
  | "Strong Bearish";

export type SentimentSortKey =
  | "sentimentScore"
  | "netDollarFlow"
  | "buyValue"
  | "sellValue"
  | "buyerRatio"
  | "ticker";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface RawSentimentTrade {
  id: number;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  insiderName: string;
  filingDate: string | null;
  transactionDate: string | null;
  transactionCode: "P" | "S";
  shares: number;
  pricePerShare: number | null;
  valueUsd: number;
}

export interface InsiderSentimentRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  buyTransactions: number;
  sellTransactions: number;
  buyValue: number;
  sellValue: number;
  netDollarFlow: number;
  buyShares: number;
  sellShares: number;
  netShares: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  uniqueInsiders: number;
  buyerRatio: number;
  buySellTransactionRatio: number | null;
  buySellDollarRatio: number | null;
  totalTrades: number;
  sentimentScore: number;
  classification: SentimentClassification;
  firstTrade: string | null;
  latestTrade: string | null;
}

export interface InsiderSentimentSummary {
  mostBullishStocks: number;
  mostBearishStocks: number;
  netInsiderBuying: number;
  averageSentimentScore: number;
  topBullishTicker: string | null;
  topBearishTicker: string | null;
}

export interface InsiderSentimentCachePayload {
  version: 1;
  computedAt: string;
  rows: InsiderSentimentRow[];
  sectors: string[];
}

export interface InsiderSentimentPayload {
  computedAt: string;
  summary: InsiderSentimentSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: SentimentSortKey;
  sortDir: "asc" | "desc";
  rows: InsiderSentimentRow[];
}

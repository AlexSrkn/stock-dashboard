export type StocksMostAccumulatedPeriod = "30d" | "90d" | "year";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface StocksMostAccumulatedRow {
  ticker: string;
  companyName: string | null;
  accumulationScore: number;
  netBoughtValueUsd: number;
  institutionalBuyingUsd: number;
  insiderBuyingUsd: number;
  politicianBuyingUsd: number;
  buyerCount: number;
  lastFilingDate: string | null;
  marketCapUsd: number | null;
  newPositionCount: number;
}

export interface StocksMostAccumulatedSummary {
  topStock: {
    ticker: string;
    companyName: string | null;
    accumulationScore: number;
  } | null;
  totalNetBoughtValueUsd: number;
  stockCount: number;
  averageBuyerCount: number;
}

export interface StocksMostAccumulatedPayload {
  computedAt: string;
  period: StocksMostAccumulatedPeriod;
  periodLabel: string;
  marketCap: MarketCapBucket;
  summary: StocksMostAccumulatedSummary;
  stocks: StocksMostAccumulatedRow[];
}

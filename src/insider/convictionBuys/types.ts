export type ConvictionLabel =
  | "Low Conviction"
  | "Moderate Conviction"
  | "High Conviction"
  | "Exceptional Conviction";

export type ConvictionSortKey =
  | "convictionScore"
  | "valueUsd"
  | "filingDate"
  | "purchasesLast12Months"
  | "ownershipIncreasePercent"
  | "transactionDate";

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

export interface ConvictionBuyRow {
  id: number;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  insiderName: string;
  insiderTitle: string | null;
  role: string;
  filingDate: string | null;
  transactionDate: string | null;
  shares: number;
  pricePerShare: number | null;
  valueUsd: number;
  ownershipIncreasePercent: number;
  purchasesLast12Months: number;
  amountInvestedLast12Months: number;
  convictionScore: number;
  convictionLabel: ConvictionLabel;
  purchaseSizeScore: number;
  ownershipIncreaseScore: number;
  roleScore: number;
  repeatBuyScore: number;
  roleWeight: number;
}

export interface ConvictionBuysSummary {
  highestConvictionTrade: {
    ticker: string;
    insiderName: string;
    convictionScore: number;
    valueUsd: number;
  } | null;
  averageConvictionScore: number;
  highConvictionBuys: number;
  totalCapitalDeployed: number;
}

export interface ConvictionBuysCachePayload {
  version: 1;
  computedAt: string;
  rows: ConvictionBuyRow[];
  sectors: string[];
}

export interface ConvictionBuysPayload {
  computedAt: string;
  summary: ConvictionBuysSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: ConvictionSortKey;
  sortDir: "asc" | "desc";
  rows: ConvictionBuyRow[];
}

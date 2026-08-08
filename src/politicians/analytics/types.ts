export type PoliticianAnalyticsPeriod = "30d" | "quarter" | "year";
export type PoliticianChamberFilter = "all" | "house" | "senate";

export interface PoliticianMostAccumulatedRow {
  ticker: string;
  assetLabel: string | null;
  politiciansBuying: number;
  politiciansSelling: number;
  netAmountUsd: number;
  totalBuyUsd: number;
  totalSellUsd: number;
  percentIncrease: number | null;
  totalPoliticiansActive: number;
  tradeCount: number;
  highlightManyPoliticians: boolean;
  highlightHighIncrease: boolean;
  isNewTop10: boolean;
}

export interface PoliticianMostAccumulatedSummary {
  topStock: { ticker: string; assetLabel: string | null; netAmountUsd: number } | null;
  totalPoliticiansBuying: number;
  totalNetAmountUsd: number;
  averagePercentIncrease: number | null;
}

export interface PoliticianMostAccumulatedPayload {
  period: PoliticianAnalyticsPeriod;
  periodLabel: string;
  chamber: PoliticianChamberFilter;
  available: boolean;
  unavailableReason: string | null;
  fetchedAt: string | null;
  summary: PoliticianMostAccumulatedSummary;
  stocks: PoliticianMostAccumulatedRow[];
}

export interface PoliticianPortfolioRow {
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  state: string | null;
  totalBuyUsd: number;
  totalSellUsd: number;
  netPortfolioUsd: number;
  buyCount: number;
  sellCount: number;
  tradeCount: number;
}

export interface PoliticianLargestPortfoliosPayload {
  period: PoliticianAnalyticsPeriod;
  periodLabel: string;
  chamber: PoliticianChamberFilter;
  available: boolean;
  unavailableReason: string | null;
  fetchedAt: string | null;
  politicians: PoliticianPortfolioRow[];
}

export type PoliticianTransactionTypeFilter = "all" | "buy" | "sell" | "exchange";

export interface PoliticianSectorExposureFilters {
  period: PoliticianAnalyticsPeriod;
  dateFrom: string | null;
  dateTo: string | null;
  chamber: PoliticianChamberFilter;
  politicianKey: string | null;
  state: string | null;
  transactionType: PoliticianTransactionTypeFilter;
  sector: string | null;
  search: string | null;
}

export interface PoliticianSectorStockRef {
  ticker: string;
  companyName: string | null;
  tradeCount: number;
}

export interface PoliticianSectorPoliticianRef {
  politicianKey: string;
  politicianName: string;
  buyValueUsd: number;
}

export interface PoliticianSectorRow {
  sector: string;
  sectorSlug: string;
  tradeCount: number;
  politicianCount: number;
  totalEstimatedValueUsd: number;
  buyCount: number;
  sellCount: number;
  exchangeCount: number;
  netBuyCount: number;
  mostTradedStock: PoliticianSectorStockRef | null;
  largestBuyer: PoliticianSectorPoliticianRef | null;
}

export interface PoliticianSectorChartRow {
  sector: string;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
}

export interface PoliticianSectorMonthlyRow {
  month: string;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  sectors: { sector: string; tradeCount: number }[];
}

export interface PoliticianSectorExposureSummary {
  totalTrades: number;
  totalPoliticians: number;
  sectorCount: number;
  mostTradedSector: string | null;
}

export interface PoliticianSectorExposurePayload {
  period: PoliticianAnalyticsPeriod;
  periodLabel: string;
  chamber: PoliticianChamberFilter;
  available: boolean;
  unavailableReason: string | null;
  fetchedAt: string | null;
  filters: PoliticianSectorExposureFilters;
  summary: PoliticianSectorExposureSummary;
  sectors: string[];
  politicians: { politicianKey: string; politicianName: string }[];
  states: string[];
  rows: PoliticianSectorRow[];
  charts: {
    sectorAllocation: PoliticianSectorChartRow[];
    buyVsSell: PoliticianSectorChartRow[];
    monthlyActivity: PoliticianSectorMonthlyRow[];
  };
}

export interface PoliticianSectorTradeRow {
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  state: string | null;
  ticker: string | null;
  companyName: string | null;
  transactionCategory: string;
  transactionType: string;
  transactionDate: string | null;
  amountUsd: number;
  amountRange: string | null;
  filingDate: string | null;
}

export interface PoliticianSectorDetailPayload {
  sector: string;
  sectorSlug: string;
  available: boolean;
  unavailableReason: string | null;
  fetchedAt: string | null;
  filters: PoliticianSectorExposureFilters;
  summary: {
    tradeCount: number;
    buyCount: number;
    sellCount: number;
    politicianCount: number;
    totalEstimatedValueUsd: number;
  };
  politicians: {
    politicianKey: string;
    politicianName: string;
    chamber: "house" | "senate";
    state: string | null;
    tradeCount: number;
    buyCount: number;
    sellCount: number;
    netAmountUsd: number;
  }[];
  mostTradedStocks: {
    ticker: string;
    companyName: string | null;
    tradeCount: number;
    totalValueUsd: number;
  }[];
  largestPurchases: PoliticianSectorTradeRow[];
  largestSales: PoliticianSectorTradeRow[];
  monthlyActivity: PoliticianSectorMonthlyRow[];
  recentDisclosures: PoliticianSectorTradeRow[];
}

export interface PoliticianProfileSectorSlice {
  sector: string;
  weightPct: number;
  totalValueUsd: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
}

export interface PoliticianProfileSectorPayload {
  politicianKey: string;
  politicianName: string;
  available: boolean;
  unavailableReason: string | null;
  fetchedAt: string | null;
  period: PoliticianAnalyticsPeriod;
  periodLabel: string;
  sectorAllocation: PoliticianProfileSectorSlice[];
  mostTradedSectors: PoliticianProfileSectorSlice[];
  buyVsSell: {
    buyCount: number;
    sellCount: number;
    exchangeCount: number;
    buyValueUsd: number;
    sellValueUsd: number;
  };
  monthlySectorActivity: PoliticianSectorMonthlyRow[];
}

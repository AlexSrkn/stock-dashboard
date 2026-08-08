/** Raw holding row (DB or in-memory). */
export interface InstitutionHolding {
  institutionId: string;
  quarter: string;
  ticker: string;
  marketValue: number;
  shares?: number | null;
  cusip?: string | null;
}

export interface PriceData {
  ticker: string;
  date: string;
  price: number;
}

/** Portfolio weights for one institution-quarter. */
export interface InstitutionPortfolioSnapshot {
  institutionId: string;
  quarter: string;
  /** ticker → weight (sums to ~1 when fully priced). */
  weights: Record<string, number>;
  totalPortfolioValue: number;
}

export interface InstitutionQuarterPerformance {
  institutionId: string;
  quarter: string;
  return: number | null;
}

export interface InstitutionPerformanceSummary {
  institutionId: string;
  quarter: string;
  qoqReturn: number | null;
  rolling1yReturn: number | null;
  ytdReturn: number | null;
  consistencyScore: number | null;
  volatility: number | null;
  bestQuarter: number | null;
  worstQuarter: number | null;
}

export interface QuarterlyStockReturn {
  ticker: string;
  quarter: string;
  return: number | null;
}

export interface InstitutionPerformanceOptions {
  /** Minimum valid quarters required for rolling 1Y (default 3). */
  rollingMinQuarters?: number;
  /** Rolling window size in quarters (default 4). */
  rollingWindowQuarters?: number;
}

export interface PriceProvider {
  /** Latest close on or before `date` (ISO YYYY-MM-DD). */
  getPrice(ticker: string, date: string): Promise<number | null>;
}

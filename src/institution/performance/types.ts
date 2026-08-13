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

/**
 * Validation / debug stats for one reconstructed QoQ return.
 * Return for `quarter` uses previous-quarter holdings as weights.
 */
export interface QuarterPerformanceDebug {
  institutionId: string;
  /** Return quarter (current 13F quarter end). */
  quarter: string;
  previousQuarter: string;
  /** Calendar quarter-end date used as the previous 13F date (YYYY-MM-DD). */
  previous13fDate: string;
  /** Calendar quarter-end date used as the current 13F date (YYYY-MM-DD). */
  current13fDate: string;
  previousPositionCount: number;
  matchedSecurities: number;
  /** Positions in the current 13F that were absent previously (excluded from this quarter's return). */
  newPositionsExcluded: number;
  /** Positions present previously but absent in the current 13F (still contribute via prior weights). */
  soldPositions: number;
  portfolioStartingValue: number;
  weightedReturn: number | null;
}

export interface InstitutionPerformanceSummary {
  institutionId: string;
  quarter: string;
  qoqReturn: number | null;
  rolling1yReturn: number | null;
  ytdReturn: number | null;
  /** Share of available QoQ returns that are positive (0..1). Null when insufficient data. */
  consistencyScore: number | null;
  /** Annualized volatility of available QoQ returns: stdev(qoq) * sqrt(4). Null when insufficient. */
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
  /**
   * Minimum valid quarters required for rolling 1Y.
   * Default 4 — do not compute Rolling 1Y from fewer than four quarters.
   */
  rollingMinQuarters?: number;
  /** Rolling window size in quarters (default 4). */
  rollingWindowQuarters?: number;
  /** Minimum finite QoQ observations required for volatility (default 2). */
  volatilityMinObservations?: number;
  /**
   * Only use the latest N distinct 13F holdings quarters when reconstructing returns.
   * Default: no cap (use all available consecutive holdings quarters).
   * Set a positive number to limit history (e.g. 4).
   */
  maxHoldingsQuarters?: number | null;
}

/**
 * Methodology metadata for API / UI.
 * Returns use unadjusted close prices (price return), not dividend-adjusted total return.
 */
export const PERFORMANCE_METHODOLOGY = {
  title: "13F-implied portfolio performance",
  returnType: "price_return" as const,
  note:
    "Returns are reconstructed from quarter-end 13F holdings and market prices. They are estimates, not the institution's reported portfolio returns. 13F filings do not reveal intra-quarter trades or cash positions.",
  limitations:
    "Prior-quarter holdings are held constant through the quarter. Fully sold names still contribute that quarter's market return; new buys appear only in later quarters.",
};

export interface PriceProvider {
  /** Latest close on or before `date` (ISO YYYY-MM-DD). */
  getPrice(ticker: string, date: string): Promise<number | null>;
}

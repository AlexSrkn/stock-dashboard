/** 13F Portfolio Performance Proxy — reported portfolio value changes, not investment returns. */

export type PortfolioProxySortKey =
  | "growth_1y"
  | "growth_3y"
  | "growth_qoq"
  | "portfolio_value"
  | "dollar_growth"
  | "holdings";

export interface PortfolioValuePoint {
  quarter: string;
  portfolioValueUsd: number;
  holdingsCount: number;
  filingDate: string | null;
  /** QoQ $ change vs prior calendar quarter when that quarter exists; else null. */
  qoqChangeUsd: number | null;
  /** QoQ % change vs prior calendar quarter when that quarter exists; else null. */
  qoqChangePct: number | null;
}

export interface PortfolioProxyRankingRow {
  rank: number;
  cik: string;
  name: string;
  type: string;
  quarter: string;
  latestFilingDate: string | null;
  currentPortfolioValueUsd: number;
  previousPortfolioValueUsd: number | null;
  qoqChangeUsd: number | null;
  qoqChangePct: number | null;
  yearAgoPortfolioValueUsd: number | null;
  change1yUsd: number | null;
  change1yPct: number | null;
  /** Computed when 12-quarter history exists; not shown in the default table yet. */
  threeYearAgoPortfolioValueUsd: number | null;
  change3yUsd: number | null;
  change3yPct: number | null;
  holdingsCount: number;
  history: PortfolioValuePoint[];
}

export interface PortfolioProxyFilters {
  quarter?: string | null;
  minPortfolioValue?: number | null;
  minHoldings?: number | null;
  minGrowth1yPct?: number | null;
  minGrowth3yPct?: number | null;
  name?: string | null;
  cik?: string | null;
  sort?: PortfolioProxySortKey;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface PortfolioProxyRankingsPayload {
  label: string;
  disclaimer: string;
  methodology: string;
  computedAt: string;
  asOfQuarter: string | null;
  availableQuarters: string[];
  sort: PortfolioProxySortKey;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rankings: PortfolioProxyRankingRow[];
}

export const PORTFOLIO_PROXY_DISCLAIMER =
  "This ranking reflects changes in the reported value of an institution's disclosed 13F portfolio between filing periods. It is not the institution's actual investment return.";

export const PORTFOLIO_PROXY_METHODOLOGY =
  "Portfolio Value = SUM(value of all reported 13F holdings) in USD for the primary filing in each quarter (largest reported total). QoQ / 1Y / 3Y compare exact reporting quarters only using those raw USD totals; missing quarters are N/A and never interpolated. Percent growth is suppressed when the prior book is below $5M, is less than 5% of the current book, or exceeds ±500% (typical of capital inflows or first full filings). This is a reported-value proxy, not an investment return.";

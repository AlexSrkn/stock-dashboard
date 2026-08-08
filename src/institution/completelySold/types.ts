export interface CompletelySoldPositionRow {
  institutionId: string;
  institutionName: string;
  institutionType: string;
  ticker: string | null;
  companyName: string | null;
  sector: string | null;
  cusip: string;
  quarter: string;
  filingDate: string | null;
  previousPositionValueUsd: number | null;
  previousShares: number;
  previousPortfolioWeightPct: number | null;
  currentPosition: "Sold";
}

export interface CompletelySoldSummary {
  totalPositionsSold: number;
  institutionsReporting: number;
  uniqueStocksSold: number;
  totalValueExitedUsd: number;
}

export interface CompletelySoldInstitutionOption {
  cik: string;
  name: string;
}

export interface CompletelySoldPayload {
  computedAt: string;
  quarters: string[];
  sectors: string[];
  institutions: CompletelySoldInstitutionOption[];
  summary: CompletelySoldSummary;
  positions: CompletelySoldPositionRow[];
}

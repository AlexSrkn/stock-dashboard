export interface NewInstitutionalPositionRow {
  institutionId: string;
  institutionName: string;
  institutionType: string;
  ticker: string | null;
  companyName: string | null;
  sector: string | null;
  cusip: string;
  quarter: string;
  filingDate: string | null;
  positionValueUsd: number | null;
  shares: number;
  portfolioWeightPct: number | null;
  previousPosition: "None";
}

export interface NewPositionsSummary {
  totalNewPositions: number;
  institutionsReporting: number;
  uniqueStocks: number;
  totalReportedValueUsd: number;
}

export interface NewPositionsInstitutionOption {
  cik: string;
  name: string;
}

export interface NewPositionsPayload {
  computedAt: string;
  quarters: string[];
  sectors: string[];
  institutions: NewPositionsInstitutionOption[];
  summary: NewPositionsSummary;
  positions: NewInstitutionalPositionRow[];
}

export interface CompareHoldingRow {
  cusip: string;
  ticker: string | null;
  companyName: string | null;
  sector: string | null;
  valueUsd: number;
  weightPct: number;
  shares: number;
  quarter: string;
}

export interface CompareLargestHolding {
  ticker: string | null;
  companyName: string | null;
  valueUsd: number;
  weightPct: number;
}

export interface CompareSectorSlice {
  sector: string;
  valueUsd: number;
  weightPct: number;
}

export interface InstitutionCompareSide {
  cik: string;
  name: string;
  type: string;
  quarter: string;
  filingDate: string | null;
  portfolioValueUsd: number;
  holdingsCount: number;
  largestHolding: CompareLargestHolding | null;
  topSector: CompareSectorSlice | null;
  topHoldings: CompareHoldingRow[];
  sectorAllocation: CompareSectorSlice[];
}

export interface SharedCompareHoldingRow {
  cusip: string;
  ticker: string | null;
  companyName: string | null;
  sector: string | null;
  institutionA: {
    valueUsd: number;
    weightPct: number;
    shares: number;
  };
  institutionB: {
    valueUsd: number;
    weightPct: number;
    shares: number;
  };
  weightDifferencePct: number;
}

export interface InstitutionCompareStats {
  sharedCount: number;
  uniqueToACount: number;
  uniqueToBCount: number;
  jaccardSimilarityPct: number;
  weightedSimilarityPct: number | null;
  hasSectorData: boolean;
}

export interface InstitutionComparePayload {
  computedAt: string;
  institutionA: InstitutionCompareSide;
  institutionB: InstitutionCompareSide;
  stats: InstitutionCompareStats;
  sharedHoldings: SharedCompareHoldingRow[];
  uniqueToA: CompareHoldingRow[];
  uniqueToB: CompareHoldingRow[];
}

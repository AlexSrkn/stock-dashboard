export interface InstitutionSummary {
  name: string;
  cik: string;
  type: string;
}

export interface InstitutionProfileMeta {
  name: string;
  cik: string;
  type: string;
  currentQuarter: string | null;
  previousQuarter: string | null;
  latestFilingDate: string | null;
  positionCount: number;
  portfolioValueUsd: number | null;
  filingsOnRecord: number;
  /** When set, holdings/activity aggregate across these related SEC CIKs. */
  relatedCiks?: string[];
  filerGroupId?: string | null;
  filerGroupNote?: string | null;
}

export interface InstitutionHoldingRow {
  ticker: string | null;
  issuer: string;
  cusip: string;
  shares: number;
  valueUsd: number | null;
  pctOfPortfolio: number | null;
}

export interface InstitutionActivityRow {
  ticker: string | null;
  issuer: string;
  cusip: string;
  currentShares: number;
  previousShares: number;
  sharesChange: number;
  sharesChangePct: number | null;
  currentValueUsd: number | null;
  previousValueUsd: number | null;
  valueChangeUsd: number | null;
}

export interface InstitutionFilingRow {
  accessionNumber: string;
  formType: string;
  filingDate: string;
  reportPeriod: string | null;
  quarter: string;
  holdingsCount: number;
  totalValueUsd: number | null;
  /** SEC EDGAR filing index (links to primary/info-table HTML views). */
  href: string;
}

export interface InstitutionProfileResponse {
  meta: InstitutionProfileMeta;
}

export interface InstitutionHoldingsResponse {
  meta: InstitutionProfileMeta;
  holdings: InstitutionHoldingRow[];
}

export interface InstitutionActivityResponse {
  meta: InstitutionProfileMeta;
  activity: InstitutionActivityRow[];
  adds: InstitutionActivityRow[];
  trims: InstitutionActivityRow[];
  newPositions: InstitutionActivityRow[];
  completelySold: InstitutionActivityRow[];
  previousPortfolioValueUsd: number | null;
}

export interface InstitutionHistoryResponse {
  meta: InstitutionProfileMeta;
  filings: InstitutionFilingRow[];
}

export interface InstitutionOptionRow {
  ticker: string | null;
  issuer: string;
  cusip: string;
  /** Option contracts / shares reported on 13F. */
  contracts: number;
  /** Filing market value (USD) from 13F info table. */
  valueUsd: number | null;
  /** Common-stock value for the same underlying (same quarter), when held. */
  commonValueUsd: number | null;
}

export interface InstitutionOptionsResponse {
  meta: InstitutionProfileMeta;
  /** Sum of common-stock holdings value for the latest quarter. */
  commonExposureUsd: number;
  calls: InstitutionOptionRow[];
  puts: InstitutionOptionRow[];
}

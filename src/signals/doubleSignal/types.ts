export type DoubleSignalWindowDays = 90 | 180 | 365;

export const DEFAULT_DOUBLE_SIGNAL_WINDOW: DoubleSignalWindowDays = 90;

export const DOUBLE_SIGNAL_WINDOW_OPTIONS: readonly DoubleSignalWindowDays[] = [90, 180, 365];

export type InstitutionalBuyType = "new" | "increase";

export interface InstitutionalBuyEvent {
  institutionId: string;
  institutionName: string;
  institutionType: string;
  cusip: string;
  ticker: string | null;
  companyName: string | null;
  buyType: InstitutionalBuyType;
  positionValueUsd: number | null;
  sharesChange: number;
  currentShares: number;
  filingDate: string | null;
  quarter: string | null;
}

export interface InsiderBuyEvent {
  ticker: string;
  insiderName: string;
  insiderTitle: string | null;
  transactionDate: string | null;
  transactionValue: number;
  shares: number;
  cik: string;
}

export interface DoubleSignalRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  cusip: string | null;
  institutionCount: number;
  institutionIds: string[];
  insiderPurchaseCount: number;
  insiderRoles: {
    ceo: boolean;
    officer: boolean;
    director: boolean;
  };
  largestInstitutionalPositionUsd: number | null;
  largestInsiderPurchaseUsd: number;
  latestInstitutionalFilingDate: string | null;
  latestInsiderPurchaseDate: string | null;
  signalStrengthScore: number;
  totalInstitutionalValueUsd: number;
  totalInsiderPurchaseUsd: number;
}

export interface DoubleSignalSummary {
  totalDoubleSignals: number;
  uniqueStocks: number;
  institutionsInvolved: number;
  insiderPurchases: number;
}

export interface DoubleSignalInstitutionOption {
  cik: string;
  name: string;
}

export interface DoubleSignalTimelineEvent {
  date: string;
  type: "institution" | "insider";
  label: string;
  detail: string;
  valueUsd: number | null;
}

export interface DoubleSignalDetailPayload {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  signalStrengthScore: number;
  institutionEvents: InstitutionalBuyEvent[];
  insiderEvents: InsiderBuyEvent[];
  timeline: DoubleSignalTimelineEvent[];
}

export interface DoubleSignalPayload {
  computedAt: string;
  windowDays: DoubleSignalWindowDays;
  latest13fFilingDate: string | null;
  windowStart: string;
  windowEnd: string;
  summary: DoubleSignalSummary;
  sectors: string[];
  institutions: DoubleSignalInstitutionOption[];
  signals: DoubleSignalRow[];
}

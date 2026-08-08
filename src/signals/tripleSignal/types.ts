import type {
  InstitutionalBuyEvent,
  InsiderBuyEvent,
} from "../doubleSignal/types.js";

export type TripleSignalWindowDays = 90 | 180 | 365;

export const DEFAULT_TRIPLE_SIGNAL_WINDOW: TripleSignalWindowDays = 180;

export const TRIPLE_SIGNAL_WINDOW_OPTIONS: readonly TripleSignalWindowDays[] = [90, 180, 365];

export type { InstitutionalBuyEvent, InsiderBuyEvent };

export interface PoliticianBuyEvent {
  politicianKey: string;
  politicianName: string;
  chamber: "house" | "senate";
  party: string | null;
  state: string | null;
  ticker: string;
  companyName: string | null;
  transactionDate: string | null;
  disclosureDate: string | null;
  estimatedPurchaseUsd: number;
  filingId: string | null;
  sourceUrl: string | null;
}

export interface TripleSignalRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  cusip: string | null;
  institutionCount: number;
  institutionIds: string[];
  insiderPurchaseCount: number;
  politicianPurchaseCount: number;
  insiderRoles: {
    ceo: boolean;
    officer: boolean;
    director: boolean;
  };
  largestInstitutionalPositionUsd: number | null;
  largestInsiderPurchaseUsd: number;
  largestPoliticianPurchaseUsd: number;
  latestInstitutionalFilingDate: string | null;
  latestInsiderPurchaseDate: string | null;
  latestPoliticianPurchaseDate: string | null;
  signalStrengthScore: number;
  totalInstitutionalValueUsd: number;
  totalInsiderPurchaseUsd: number;
  totalPoliticianPurchaseUsd: number;
}

export interface TripleSignalSummary {
  totalTripleSignals: number;
  uniqueStocks: number;
  institutionsInvolved: number;
  insiderPurchases: number;
  politicianPurchases: number;
}

export interface TripleSignalInstitutionOption {
  cik: string;
  name: string;
}

export interface TripleSignalTimelineEvent {
  date: string;
  type: "institution" | "insider" | "politician";
  label: string;
  detail: string;
  valueUsd: number | null;
}

export interface TripleSignalDetailPayload {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  signalStrengthScore: number;
  institutionEvents: InstitutionalBuyEvent[];
  insiderEvents: InsiderBuyEvent[];
  politicianEvents: PoliticianBuyEvent[];
  timeline: TripleSignalTimelineEvent[];
}

export interface TripleSignalPayload {
  computedAt: string;
  windowDays: TripleSignalWindowDays;
  latest13fFilingDate: string | null;
  windowStart: string;
  windowEnd: string;
  summary: TripleSignalSummary;
  sectors: string[];
  institutions: TripleSignalInstitutionOption[];
  signals: TripleSignalRow[];
}

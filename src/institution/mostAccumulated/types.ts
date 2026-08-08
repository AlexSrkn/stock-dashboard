export type MostAccumulatedPeriod = "quarter" | "30d" | "year";

export interface MostAccumulatedRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  institutionsBuying: number;
  netSharesAdded: number;
  percentIncrease: number | null;
  totalInstitutionsOwning: number;
  previousTotalShares: number;
  currentTotalShares: number;
  reportedValueUsd: number;
  isNewTop10: boolean;
  highlightManyInstitutions: boolean;
  highlightHighIncrease: boolean;
}

export interface MostAccumulatedSummary {
  topStock: { ticker: string; companyName: string | null; netSharesAdded: number } | null;
  totalInstitutionsBuying: number;
  totalNetSharesAdded: number;
  averagePercentIncrease: number | null;
}

export interface MostAccumulatedPeriodPayload {
  period: MostAccumulatedPeriod;
  periodLabel: string;
  currentPeriod: string;
  previousPeriod: string | null;
  available: boolean;
  unavailableReason: string | null;
  summary: MostAccumulatedSummary;
  stocks: MostAccumulatedRow[];
}

export interface MostAccumulatedPayload {
  computedAt: string;
  sectors: string[];
  periods: Record<MostAccumulatedPeriod, MostAccumulatedPeriodPayload>;
}

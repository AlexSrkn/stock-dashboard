export type ConflictSignalType =
  | "institutions_buying_insiders_selling"
  | "institutions_selling_insiders_buying"
  | "strong_divergence"
  | "double_conviction_conflict";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export type InsiderRoleFilter = "" | "ceo" | "cfo" | "director" | "officer";

export interface ConflictSignalInsiderRoles {
  ceo: boolean;
  cfo: boolean;
  director: boolean;
  officer: boolean;
}

export interface ConflictSignalRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  institutionScore: number;
  insiderScore: number;
  conflictScore: number;
  signalType: ConflictSignalType;
  signalTypes: ConflictSignalType[];
  institutionsBuyingCount: number;
  institutionsSellingCount: number;
  insidersBuyingCount: number;
  insidersSellingCount: number;
  newPositions: number;
  fullyExited: number;
  netSharesAdded: number;
  ownershipChangePct: number;
  insiderBuyVolumeUsd: number;
  insiderSellVolumeUsd: number;
  cLevelSellers: number;
  cLevelBuyers: number;
  insiderRoles: ConflictSignalInsiderRoles;
  currentQuarter: string;
}

export interface ConflictSignalSummary {
  totalSignals: number;
  bullishConflicts: number;
  bearishConflicts: number;
  strongDivergences: number;
  doubleConviction: number;
  currentQuarter: string;
  previousQuarter: string | null;
}

export interface ConflictSignalsCachePayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  insiderWindowDays: number;
  summary: ConflictSignalSummary;
  sectors: string[];
  signals: ConflictSignalRow[];
}

export interface ConflictSignalsPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  insiderWindowDays: number;
  summary: ConflictSignalSummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  sortDir: "asc" | "desc";
  signals: ConflictSignalRow[];
}

export const CONFLICT_SIGNAL_TYPE_LABELS: Record<ConflictSignalType, string> = {
  institutions_buying_insiders_selling: "Institutions buying / Insiders selling",
  institutions_selling_insiders_buying: "Institutions selling / Insiders buying",
  strong_divergence: "Strong divergence",
  double_conviction_conflict: "Double conviction conflict",
};


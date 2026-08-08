export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export type DiscoveryClassification =
  | "Early Interest"
  | "Emerging Discovery"
  | "Institutional Discovery"
  | "Rapid Institutional Adoption"
  | "Strong Institutional Discovery"
  | "Insufficient Data";

export interface DiscoveryScoreComponents {
  holderGrowthScore: number;
  newHolderScore: number;
  growthStreakScore: number;
  ownershipGrowthScore: number;
}

export interface DiscoveryInstitution {
  cik: string;
  name: string;
  shares: number;
  valueUsd: number;
  portfolioWeight: number | null;
  firstRecordedQuarter: string | null;
  latestQuarter: string;
}

export interface DiscoveryHistoryPoint {
  quarter: string;
  holderCount: number;
  newHolderCount: number;
  exitedHolderCount: number;
  firstTimePositionCount: number;
  institutionalOwnershipPercent: number;
  netHolderChange: number | null;
  holderGrowthPercent: number | null;
  discoveryScore: number | null;
  classification: DiscoveryClassification;
}

export interface InstitutionalDiscoveryRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCapUsd: number | null;
  quarter: string;
  previousQuarter: string | null;
  currentHolderCount: number;
  previousHolderCount: number;
  netHolderChange: number;
  holderGrowthPercent: number | null;
  newHolderCount: number;
  exitedHolderCount: number;
  firstTimePositionCount: number;
  institutionalOwnershipPercent: number;
  previousInstitutionalOwnershipPercent: number;
  ownershipChangePercent: number;
  currentGrowthStreak: number;
  longestGrowthStreak: number;
  discoveryScore: number | null;
  classification: DiscoveryClassification;
  insufficientData: boolean;
  scoreComponents: DiscoveryScoreComponents | null;
  explanation: string;
  newInstitutions: DiscoveryInstitution[];
  exitedInstitutions: DiscoveryInstitution[];
  firstRecordedPositions: DiscoveryInstitution[];
  history: DiscoveryHistoryPoint[];
}

export interface InstitutionalDiscoverySummary {
  newDiscoveries: number;
  newInstitutionalPositions: number;
  fastestHolderGrowth: {
    ticker: string;
    companyName: string | null;
    holderGrowthPercent: number;
  } | null;
  longestAdoptionStreak: {
    ticker: string;
    companyName: string | null;
    streak: number;
  } | null;
  currentQuarter: string;
  previousQuarter: string | null;
}

export interface InstitutionalDiscoveryCachePayload {
  version: 1;
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  summary: InstitutionalDiscoverySummary;
  sectors: string[];
  signals: InstitutionalDiscoveryRow[];
}

export interface InstitutionalDiscoveryPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  quarters: string[];
  summary: InstitutionalDiscoverySummary;
  sectors: string[];
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  sortDir: "asc" | "desc";
  signals: InstitutionalDiscoveryRow[];
}

export type ClusterLookbackDays = 30 | 60 | 90;

export const DEFAULT_CLUSTER_LOOKBACK_DAYS: ClusterLookbackDays = 60;

export const CLUSTER_LOOKBACK_OPTIONS: readonly ClusterLookbackDays[] = [30, 60, 90];

export interface InsiderBuyRow {
  ticker: string;
  insiderName: string;
  insiderTitle: string | null;
  transactionDate: string | null;
  transactionValue: number;
  shares: number;
  cik: string;
}

export interface InsiderClusterSignal {
  ticker: string;
  insiderClusterScore: number;
  clusterStrengthLabel: string;
  buyerCount: number;
  ceoParticipation: boolean;
  totalBuyValue: number;
  roleWeightScore: number;
  clusterDensityScore: number;
  clusterSignal: string;
  clusterAlert: boolean;
  lookbackDays: ClusterLookbackDays;
  daysBetweenFirstAndLastBuy: number;
  /** Supporting detail for UI */
  supportingMetrics: {
    normalizedBuyerCount: number;
    roleWeightScoreNormalized: number;
    buyValueScore: number;
    clusterDensityRaw: number;
    ceoBonus: number;
  };
}

export interface InsiderClusterListPayload {
  computedAt: string;
  lookbackDays: ClusterLookbackDays;
  count: number;
  signals: InsiderClusterSignal[];
}

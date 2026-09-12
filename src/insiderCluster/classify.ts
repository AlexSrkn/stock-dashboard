import {
  CLUSTER_ALERT_MIN_BUYERS,
  CLUSTER_ALERT_SCORE,
  CLUSTER_SCORE_EXECUTIVE,
  CLUSTER_SCORE_LIMITED,
  CLUSTER_SCORE_MODERATE,
  CLUSTER_SCORE_STRONG,
} from "./thresholds.js";

export function clusterStrengthLabel(score: number): string {
  if (score >= CLUSTER_SCORE_EXECUTIVE) return "Executive Cluster Buying";
  if (score >= CLUSTER_SCORE_STRONG) return "Strong Insider Accumulation";
  if (score >= CLUSTER_SCORE_MODERATE) return "Moderate Insider Buying";
  if (score >= CLUSTER_SCORE_LIMITED) return "Limited Insider Activity";
  return "No Significant Cluster";
}

export function clusterAlert(buyerCount: number, ceoParticipation: boolean, score: number): boolean {
  if (buyerCount < CLUSTER_ALERT_MIN_BUYERS) return false;
  return ceoParticipation || score >= CLUSTER_ALERT_SCORE;
}

/** Shared Insider Cluster score / alert thresholds (0–100). */
export const CLUSTER_SCORE_EXECUTIVE = 85;
export const CLUSTER_SCORE_STRONG = 70;
export const CLUSTER_SCORE_MODERATE = 50;
export const CLUSTER_SCORE_LIMITED = 30;
export const CLUSTER_ALERT_MIN_BUYERS = 3;
/** Alert when ≥3 buyers and (CEO participated or score reaches this). */
export const CLUSTER_ALERT_SCORE = 80;

/** UI color bands — aligned with strength labels (strong ≥70, moderate ≥50). */
export const CLUSTER_UI_STRONG = CLUSTER_SCORE_STRONG;
export const CLUSTER_UI_MODERATE = CLUSTER_SCORE_MODERATE;

/** True only when the engine raised a cluster alert (not merely ≥3 buyers). */
export function isClusterBuyingFlag(
  cluster: { clusterAlert?: boolean | null } | null | undefined
): boolean {
  return Boolean(cluster?.clusterAlert);
}

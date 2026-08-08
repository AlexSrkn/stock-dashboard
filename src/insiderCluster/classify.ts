export function clusterStrengthLabel(score: number): string {
  if (score >= 85) return "Executive Cluster Buying";
  if (score >= 70) return "Strong Insider Accumulation";
  if (score >= 50) return "Moderate Insider Buying";
  if (score >= 30) return "Limited Insider Activity";
  return "No Significant Cluster";
}

export function clusterAlert(buyerCount: number, ceoParticipation: boolean, score: number): boolean {
  if (buyerCount < 3) return false;
  return ceoParticipation || score >= 80;
}

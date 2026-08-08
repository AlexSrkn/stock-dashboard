export type ActivityTrend = "bullish" | "neutral" | "bearish";

/** Classify net flow into bullish / neutral / bearish from buy vs sell totals. */
export function classifyActivityTrend(
  net: number,
  buyTotal: number,
  sellTotal: number
): ActivityTrend {
  if (buyTotal <= 0 && sellTotal <= 0) return "neutral";
  const total = buyTotal + sellTotal;
  if (total > 0 && Math.abs(net) / total < 0.05) return "neutral";
  if (net > 0) return "bullish";
  if (net < 0) return "bearish";
  return "neutral";
}

/** Shared Smart Money display / signal thresholds (0–100 score). */
export const SMART_MONEY_BULLISH_SCORE = 65;
export const SMART_MONEY_BEARISH_SCORE = 35;
/** Stronger band used for “high” signal strength on stock cards. */
export const SMART_MONEY_HIGH_BULLISH_SCORE = 70;
export const SMART_MONEY_HIGH_BEARISH_SCORE = 30;

export function smartMoneyIsBullish(score: number): boolean {
  return Number.isFinite(score) && score >= SMART_MONEY_BULLISH_SCORE;
}

export function smartMoneyIsBearish(score: number): boolean {
  return Number.isFinite(score) && score <= SMART_MONEY_BEARISH_SCORE;
}

export function smartMoneyQualifies(score: number): boolean {
  return smartMoneyIsBullish(score) || smartMoneyIsBearish(score);
}

export function smartMoneyLabel(score: number): "Bullish" | "Bearish" | "Neutral" {
  if (smartMoneyIsBullish(score)) return "Bullish";
  if (smartMoneyIsBearish(score)) return "Bearish";
  return "Neutral";
}

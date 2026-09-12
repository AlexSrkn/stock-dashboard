export type { SmartMoneyScore, SmartMoneyScoresPayload, TickerRawSignals } from "./types.js";
export {
  SMART_MONEY_BEARISH_SCORE,
  SMART_MONEY_BULLISH_SCORE,
  SMART_MONEY_HIGH_BEARISH_SCORE,
  SMART_MONEY_HIGH_BULLISH_SCORE,
  smartMoneyIsBearish,
  smartMoneyIsBullish,
  smartMoneyLabel,
  smartMoneyQualifies,
} from "./thresholds.js";
export { insiderRoleWeight, signedTransactionValue } from "./roleWeights.js";
export {
  zScoreNormalizeMap,
  convictionScoreFromFinal,
  blendToConvictionScore,
  signedLog1p,
  signNonZero,
} from "./normalize.js";
export {
  computeAlignmentScore,
  computeWeightedRawScore,
  buildSmartMoneyScores,
} from "./compositeScore.js";
export { loadTickerRawSignals } from "./aggregate.js";
export {
  ensureSmartMoneyCacheOnStartup,
  loadSmartMoneyScoresFromDisk,
  saveSmartMoneyScoresToDisk,
} from "./cache.js";
export { getSmartMoneyService, SmartMoneyService } from "./smartMoneyService.js";

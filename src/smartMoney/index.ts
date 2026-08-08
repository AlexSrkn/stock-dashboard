export type { SmartMoneyScore, SmartMoneyScoresPayload, TickerRawSignals } from "./types.js";
export { insiderRoleWeight, signedTransactionValue } from "./roleWeights.js";
export {
  zScoreNormalizeMap,
  convictionScoreFromFinal,
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

export type {
  InstitutionHolding,
  InstitutionPerformanceOptions,
  InstitutionPerformanceSummary,
  InstitutionPortfolioSnapshot,
  InstitutionQuarterPerformance,
  PriceData,
  QuarterlyStockReturn,
} from "./types.js";

export {
  parseQuarter,
  formatQuarter,
  compareQuarters,
  sortQuarters,
  previousQuarter,
  quarterYear,
  quarterDateRange,
  quartersYtdThrough,
  nextQuarter,
  expandQuarterRange,
  quartersForHoldings,
} from "./quarters.js";

export { buildPortfolioSnapshots, indexPortfolioSnapshots } from "./portfolioWeights.js";

export { MapPriceProvider, priceOnOrBefore } from "./priceProvider.js";

export { loadAllPricesBatch, closeOnOrBefore, type DailyBarsByTicker } from "./dataLoader.js";

export {
  ReturnsMatrix,
  computeTickerQuarterReturns,
  warmReturnsMatrix,
  ensureReturnsMatrixOnStartup,
  getReturnsMatrix,
  requireReturnsMatrix,
  saveReturnsMatrix,
  clearReturnsMatrixCache,
  type ReturnsMatrixEntry,
} from "./priceCache.js";

export {
  buildPortfolioWeightRows,
  computePortfolioReturnsFromMatrix,
  computeInstitutionPerformanceSummaries,
  type PortfolioWeightRow,
} from "./portfolioEngine.js";

export {
  compoundReturns,
  computeRolling1yReturn,
  computeYtdReturn,
  computeInstitutionHelperMetrics,
  indexQuarterReturns,
  type InstitutionHelperMetrics,
} from "./metrics.js";

export { getStockReturn } from "./stockReturns.js";

export {
  computeRolling1yReturn as computeInstitutionRolling1yReturn,
  computeYtdReturn as computeInstitutionYtdReturn,
  computeInstitutionHelperMetrics as computeInstitutionMetrics,
  indexQuarterReturns as indexInstitutionQuarterReturns,
} from "./metrics.js";

export {
  runInstitutionPerformanceEngine,
  type PerformanceEngineInput,
  type PerformanceEngineResult,
} from "./performanceEngine.js";

export { loadInstitutionHoldings } from "./holdingsLoader.js";

export {
  InstitutionPerformanceService,
  getInstitutionPerformanceService,
  type InstitutionPerformanceServiceOptions,
} from "./performanceService.js";

export { parsePerformancePeriod, buildInstitutionRankings } from "./rankings.js";
export type { PerformancePeriod, InstitutionRankingsResult } from "./rankings.js";

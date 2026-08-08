/** @deprecated Use metrics.ts and portfolioEngine.ts. Re-exports for backward compatibility. */
export {
  computeRolling1yReturn,
  computeYtdReturn,
  computeInstitutionHelperMetrics,
  indexQuarterReturns,
  compoundReturns,
  type InstitutionHelperMetrics,
} from "./metrics.js";

export {
  buildPortfolioWeightRows,
  computePortfolioReturnsFromMatrix,
  computeInstitutionPerformanceSummaries,
  type PortfolioWeightRow,
} from "./portfolioEngine.js";

import { buildPortfolioSnapshots } from "./portfolioWeights.js";
import { quartersForHoldings } from "./quarters.js";
import type { ReturnsMatrix } from "./priceCache.js";
import { computeInstitutionPerformanceSummaries } from "./portfolioEngine.js";
import type {
  InstitutionHolding,
  InstitutionPerformanceOptions,
  InstitutionPerformanceSummary,
  InstitutionQuarterPerformance,
  QuarterlyStockReturn,
} from "./types.js";

export interface PerformanceEngineInput {
  holdings: InstitutionHolding[];
  returnsMatrix: ReturnsMatrix;
  quarters?: string[];
  options?: InstitutionPerformanceOptions;
}

export interface PerformanceEngineResult {
  summaries: InstitutionPerformanceSummary[];
  portfolioSnapshots: ReturnType<typeof buildPortfolioSnapshots>;
  stockReturns: QuarterlyStockReturn[];
  institutionQuarterReturns: InstitutionQuarterPerformance[];
}

/**
 * End-to-end performance pipeline — uses only precomputed ticker-quarter returns.
 * No external API calls.
 */
export function runInstitutionPerformanceEngine(
  input: PerformanceEngineInput
): PerformanceEngineResult {
  const { holdings, returnsMatrix, options } = input;
  const quarters = input.quarters ?? quartersForHoldings(holdings);

  const portfolioSnapshots = buildPortfolioSnapshots(holdings);
  const summaries = computeInstitutionPerformanceSummaries(
    holdings,
    returnsMatrix,
    quarters,
    options
  );

  const institutionQuarterReturns = summaries.map((s) => ({
    institutionId: s.institutionId,
    quarter: s.quarter,
    return: s.qoqReturn,
  }));

  return {
    summaries,
    portfolioSnapshots,
    stockReturns: returnsMatrix.toRows(),
    institutionQuarterReturns,
  };
}

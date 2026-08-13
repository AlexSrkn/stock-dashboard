import { buildPortfolioSnapshots } from "./portfolioWeights.js";
import { filterHoldingsToLatestQuarters, quartersForHoldings } from "./quarters.js";
import type { ReturnsMatrix } from "./priceCache.js";
import { computeInstitutionPerformanceWithDebug } from "./portfolioEngine.js";
import type {
  InstitutionHolding,
  InstitutionPerformanceOptions,
  InstitutionPerformanceSummary,
  InstitutionQuarterPerformance,
  QuarterPerformanceDebug,
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
  debug: QuarterPerformanceDebug[];
}

/**
 * End-to-end 13F-implied performance pipeline — uses only precomputed ticker-quarter returns.
 * No external API calls. Does not fabricate returns for missing holdings quarters.
 * Uses all available consecutive 13F holdings quarters unless `maxHoldingsQuarters` is set.
 */
export function runInstitutionPerformanceEngine(
  input: PerformanceEngineInput
): PerformanceEngineResult {
  const { returnsMatrix, options } = input;
  const maxQ = options?.maxHoldingsQuarters ?? null;
  const holdings = filterHoldingsToLatestQuarters(input.holdings, maxQ);
  const quarters = input.quarters ?? quartersForHoldings(holdings);

  const portfolioSnapshots = buildPortfolioSnapshots(holdings);
  const { summaries, debug, institutionQuarterReturns } = computeInstitutionPerformanceWithDebug(
    holdings,
    returnsMatrix,
    quarters,
    options
  );

  return {
    summaries,
    portfolioSnapshots,
    stockReturns: returnsMatrix.toRows(),
    institutionQuarterReturns,
    debug,
  };
}

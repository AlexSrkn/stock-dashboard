import { buildPortfolioSnapshots, indexPortfolioSnapshots } from "./portfolioWeights.js";
import { compareQuarters, previousQuarter, sortQuarters } from "./quarters.js";
import type { ReturnsMatrix } from "./priceCache.js";
import type {
  InstitutionHolding,
  InstitutionPerformanceOptions,
  InstitutionPerformanceSummary,
  InstitutionQuarterPerformance,
} from "./types.js";
import {
  computeInstitutionHelperMetrics,
  computeRolling1yReturn,
  computeYtdReturn,
  indexQuarterReturns,
} from "./metrics.js";

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export interface PortfolioWeightRow {
  institutionId: string;
  returnQuarter: string;
  ticker: string;
  weight: number;
}

/**
 * Flat weight table for vectorized merge with returns matrix.
 * Each row: institution i, quarter t, weight from t-1 on ticker j.
 */
export function buildPortfolioWeightRows(
  portfolioIndex: ReturnType<typeof indexPortfolioSnapshots>,
  institutionIds: string[],
  quarters: string[]
): PortfolioWeightRow[] {
  const rows: PortfolioWeightRow[] = [];
  const sortedQs = sortQuarters(quarters);

  for (const institutionId of institutionIds) {
    const byQuarter = portfolioIndex.get(institutionId);
    if (!byQuarter) continue;

    for (const returnQuarter of sortedQs) {
      const prevQ = previousQuarter(returnQuarter);
      if (!prevQ) continue;
      const prevSnap = byQuarter.get(prevQ);
      if (!prevSnap || prevSnap.totalPortfolioValue <= 0) continue;

      for (const [ticker, weight] of Object.entries(prevSnap.weights)) {
        if (!Number.isFinite(weight) || weight <= 0) continue;
        rows.push({ institutionId, returnQuarter, ticker, weight });
      }
    }
  }

  return rows;
}

/**
 * R_i,t = Σ weight(i, j, t-1) * return(j, t)
 * Single pass over weight rows merged with precomputed returns matrix.
 */
export function computePortfolioReturnsFromMatrix(
  weightRows: PortfolioWeightRow[],
  returnsMatrix: ReturnsMatrix
): InstitutionQuarterPerformance[] {
  const acc = new Map<string, { weighted: number; usedWeight: number }>();

  for (const row of weightRows) {
    const stockR = returnsMatrix.get(row.ticker, row.returnQuarter);
    if (stockR == null) continue;

    const key = `${row.institutionId}::${row.returnQuarter}`;
    const cur = acc.get(key) ?? { weighted: 0, usedWeight: 0 };
    cur.weighted += row.weight * stockR;
    cur.usedWeight += row.weight;
    acc.set(key, cur);
  }

  const out: InstitutionQuarterPerformance[] = [];
  for (const [key, { weighted, usedWeight }] of acc) {
    if (usedWeight <= 0) continue;
    const [institutionId, returnQuarter] = key.split("::");
    out.push({
      institutionId,
      quarter: returnQuarter,
      return: round6(weighted),
    });
  }

  return out;
}

export function computeInstitutionPerformanceSummaries(
  holdings: InstitutionHolding[],
  returnsMatrix: ReturnsMatrix,
  quarters: string[],
  options: InstitutionPerformanceOptions = {}
): InstitutionPerformanceSummary[] {
  const portfolioSnapshots = buildPortfolioSnapshots(holdings);
  const portfolioIndex = indexPortfolioSnapshots(portfolioSnapshots);
  const institutionIds = [...portfolioIndex.keys()];

  const weightRows = buildPortfolioWeightRows(portfolioIndex, institutionIds, quarters);
  const institutionQuarterReturns = computePortfolioReturnsFromMatrix(weightRows, returnsMatrix);
  const qoqIndex = indexQuarterReturns(institutionQuarterReturns);

  const summaries: InstitutionPerformanceSummary[] = [];

  for (const institutionId of institutionIds) {
    const byQuarter = qoqIndex.get(institutionId) ?? new Map();
    const helpers = computeInstitutionHelperMetrics(byQuarter);

    for (const quarter of sortQuarters(quarters)) {
      summaries.push({
        institutionId,
        quarter,
        qoqReturn: byQuarter.get(quarter) ?? null,
        rolling1yReturn: computeRolling1yReturn(byQuarter, quarter, options),
        ytdReturn: computeYtdReturn(byQuarter, quarter),
        consistencyScore: helpers.consistencyScore,
        volatility: helpers.volatility,
        bestQuarter: helpers.bestQuarter,
        worstQuarter: helpers.worstQuarter,
      });
    }
  }

  summaries.sort((a, b) => {
    const iq = a.institutionId.localeCompare(b.institutionId);
    if (iq !== 0) return iq;
    return compareQuarters(a.quarter, b.quarter);
  });

  return summaries;
}

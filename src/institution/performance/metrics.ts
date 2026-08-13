import { previousQuarter, quartersYtdThrough, compareQuarters, sortQuarters } from "./quarters.js";
import type { InstitutionPerformanceOptions, InstitutionQuarterPerformance } from "./types.js";

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function compoundReturns(returns: number[]): number | null {
  if (!returns.length) return null;
  let product = 1;
  for (const r of returns) {
    if (!Number.isFinite(r)) return null;
    product *= 1 + r;
  }
  return round6(product - 1);
}

/**
 * Rolling 1Y = compound of four consecutive quarterly returns ending at `quarter`.
 * Requires a full window of finite returns (default 4). Never fabricates missing quarters.
 */
export function computeRolling1yReturn(
  quarterlyReturns: Map<string, number | null>,
  quarter: string,
  opts: InstitutionPerformanceOptions = {}
): number | null {
  const windowSize = opts.rollingWindowQuarters ?? 4;
  const minValid = opts.rollingMinQuarters ?? 4;

  const chain: number[] = [];
  let cursor: string | null = quarter;
  for (let k = 0; k < windowSize && cursor; k++) {
    const r = quarterlyReturns.get(cursor);
    if (r == null || !Number.isFinite(r)) return null;
    chain.unshift(r);
    cursor = previousQuarter(cursor);
  }

  if (chain.length < minValid) return null;
  return compoundReturns(chain);
}

/**
 * YTD = compound of Q1..current within the same calendar year.
 * Any missing quarter in that span → null (never treat missing as 0%).
 */
export function computeYtdReturn(
  quarterlyReturns: Map<string, number | null>,
  quarter: string
): number | null {
  const ytdQuarters = quartersYtdThrough(quarter);
  const returns: number[] = [];
  for (const q of ytdQuarters) {
    const r = quarterlyReturns.get(q);
    if (r == null || !Number.isFinite(r)) return null;
    returns.push(r);
  }
  return compoundReturns(returns);
}

export interface InstitutionHelperMetrics {
  consistencyScore: number | null;
  /** Annualized volatility: sample stdev(qoq) × √4 */
  volatility: number | null;
  bestQuarter: number | null;
  worstQuarter: number | null;
}

/** Sample stdev (ddof=1) of values, annualized by ×√4. Null if fewer than 2 observations. */
export function annualizedVolatility(
  values: number[],
  minObservations = 2
): number | null {
  if (values.length < minObservations || values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return round6(Math.sqrt(variance) * Math.sqrt(4));
}

/** Consistency = share of finite returns that are strictly positive. */
export function consistencyFromReturns(values: number[]): number | null {
  if (!values.length) return null;
  const positive = values.filter((r) => r > 0).length;
  return round6(positive / values.length);
}

/**
 * Collect up to `windowSize` consecutive finite QoQ returns ending at `quarter`
 * (calendar walk via previousQuarter). Stops early on a missing quarter.
 */
export function rollingQuarterReturns(
  quarterlyReturns: Map<string, number | null>,
  quarter: string,
  windowSize = 4
): number[] {
  const chain: number[] = [];
  let cursor: string | null = quarter;
  for (let k = 0; k < windowSize && cursor; k++) {
    const r = quarterlyReturns.get(cursor);
    if (r == null || !Number.isFinite(r)) break;
    chain.unshift(r);
    cursor = previousQuarter(cursor);
  }
  return chain;
}

/**
 * All finite QoQ returns from the earliest available quarter through `quarter`
 * (inclusive), in chronological order. Gaps before `quarter` are skipped only when
 * those quarters are absent from the map; null map entries break inclusion? We walk
 * the sorted keys that are <= quarter.
 */
export function cumulativeReturnsThrough(
  quarterlyReturns: Map<string, number | null>,
  quarter: string
): number[] {
  const values: number[] = [];
  for (const q of sortQuarters(quarterlyReturns.keys())) {
    if (compareQuarters(q, quarter) > 0) break;
    const r = quarterlyReturns.get(q);
    if (r != null && Number.isFinite(r)) values.push(r);
  }
  return values;
}

/**
 * Per-quarter consistency through `quarter` (all valid returns up to and including it).
 */
export function computeConsistencyThrough(
  quarterlyReturns: Map<string, number | null>,
  quarter: string
): number | null {
  return consistencyFromReturns(cumulativeReturnsThrough(quarterlyReturns, quarter));
}

/**
 * Per-quarter annualized volatility.
 * Prefers a rolling 4-quarter window ending at `quarter` when all 4 exist;
 * otherwise uses the longest available trailing consecutive window (≥2).
 */
export function computeVolatilityThrough(
  quarterlyReturns: Map<string, number | null>,
  quarter: string,
  opts: InstitutionPerformanceOptions = {}
): number | null {
  const windowSize = opts.rollingWindowQuarters ?? 4;
  const minVolObs = opts.volatilityMinObservations ?? 2;

  // Prefer full rolling window when complete
  const fullWindow: number[] = [];
  let cursor: string | null = quarter;
  for (let k = 0; k < windowSize && cursor; k++) {
    const r = quarterlyReturns.get(cursor);
    if (r == null || !Number.isFinite(r)) {
      break;
    }
    fullWindow.unshift(r);
    cursor = previousQuarter(cursor);
  }

  if (fullWindow.length === windowSize) {
    return annualizedVolatility(fullWindow, minVolObs);
  }

  // Fall back to available trailing consecutive returns (≥2)
  const trailing = rollingQuarterReturns(quarterlyReturns, quarter, windowSize);
  return annualizedVolatility(trailing, minVolObs);
}

/**
 * Institution-level helpers over the full available QoQ series (for rankings / latest).
 */
export function computeInstitutionHelperMetrics(
  quarterlyReturns: Map<string, number | null>,
  opts: InstitutionPerformanceOptions = {}
): InstitutionHelperMetrics {
  const values = [...quarterlyReturns.values()].filter(
    (r): r is number => r != null && Number.isFinite(r)
  );

  if (!values.length) {
    return {
      consistencyScore: null,
      volatility: null,
      bestQuarter: null,
      worstQuarter: null,
    };
  }

  return {
    consistencyScore: consistencyFromReturns(values),
    volatility: annualizedVolatility(values, opts.volatilityMinObservations ?? 2),
    bestQuarter: round6(Math.max(...values)),
    worstQuarter: round6(Math.min(...values)),
  };
}

/** Index institution → quarter → QoQ return */
export function indexQuarterReturns(
  rows: InstitutionQuarterPerformance[]
): Map<string, Map<string, number | null>> {
  const out = new Map<string, Map<string, number | null>>();
  for (const row of rows) {
    const byQ = out.get(row.institutionId) ?? new Map();
    byQ.set(row.quarter, row.return);
    out.set(row.institutionId, byQ);
  }
  return out;
}

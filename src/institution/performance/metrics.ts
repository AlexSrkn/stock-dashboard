import { previousQuarter, quartersYtdThrough } from "./quarters.js";
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

export function computeRolling1yReturn(
  quarterlyReturns: Map<string, number | null>,
  quarter: string,
  opts: InstitutionPerformanceOptions = {}
): number | null {
  const windowSize = opts.rollingWindowQuarters ?? 4;
  const minValid = opts.rollingMinQuarters ?? 3;

  const chain: number[] = [];
  let cursor: string | null = quarter;
  for (let k = 0; k < windowSize && cursor; k++) {
    const r = quarterlyReturns.get(cursor);
    if (r != null && Number.isFinite(r)) chain.unshift(r);
    cursor = previousQuarter(cursor);
  }

  if (chain.length < minValid) return null;
  return compoundReturns(chain);
}

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
  volatility: number | null;
  bestQuarter: number | null;
  worstQuarter: number | null;
}

export function computeInstitutionHelperMetrics(
  quarterlyReturns: Map<string, number | null>
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

  const positive = values.filter((r) => r > 0).length;
  const consistencyScore = round6(positive / values.length);

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
      : 0;
  const volatility = values.length > 1 ? round6(Math.sqrt(variance)) : null;

  return {
    consistencyScore,
    volatility,
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

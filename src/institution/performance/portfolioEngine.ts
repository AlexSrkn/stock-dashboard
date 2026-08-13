import { buildPortfolioSnapshots, indexPortfolioSnapshots } from "./portfolioWeights.js";
import { compareQuarters, previousQuarter, quarterDateRange, sortQuarters } from "./quarters.js";
import type { ReturnsMatrix } from "./priceCache.js";
import type {
  InstitutionHolding,
  InstitutionPerformanceOptions,
  InstitutionPerformanceSummary,
  InstitutionQuarterPerformance,
  QuarterPerformanceDebug,
} from "./types.js";
import {
  computeConsistencyThrough,
  computeRolling1yReturn,
  computeVolatilityThrough,
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
 * Flat weight table: institution i, return quarter t, weight from t-1 on ticker j.
 * Only emits rows when the previous-quarter snapshot exists (no look-ahead / no fabrication).
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
 * Sold names (absent in t) still contribute via t-1 weights.
 * New names in t never appear in t-1 weights (excluded / no look-ahead).
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

function tickerSet(snap: { weights: Record<string, number> } | undefined): Set<string> {
  if (!snap) return new Set();
  return new Set(Object.keys(snap.weights));
}

/**
 * Build per-quarter validation stats for reconstructed returns.
 */
export function buildQuarterPerformanceDebug(
  portfolioIndex: ReturnType<typeof indexPortfolioSnapshots>,
  returnsMatrix: ReturnsMatrix,
  institutionQuarterReturns: InstitutionQuarterPerformance[]
): QuarterPerformanceDebug[] {
  const out: QuarterPerformanceDebug[] = [];

  for (const row of institutionQuarterReturns) {
    const prevQ = previousQuarter(row.quarter);
    if (!prevQ) continue;
    const byQ = portfolioIndex.get(row.institutionId);
    const prevSnap = byQ?.get(prevQ);
    if (!prevSnap) continue;

    const curSnap = byQ?.get(row.quarter);
    const prevTickers = tickerSet(prevSnap);
    const curTickers = tickerSet(curSnap);

    let matched = 0;
    for (const ticker of prevTickers) {
      if (returnsMatrix.get(ticker, row.quarter) != null) matched++;
    }

    let sold = 0;
    for (const t of prevTickers) {
      if (!curTickers.has(t)) sold++;
    }
    let newExcluded = 0;
    for (const t of curTickers) {
      if (!prevTickers.has(t)) newExcluded++;
    }

    const prevRange = quarterDateRange(prevQ);
    const curRange = quarterDateRange(row.quarter);

    out.push({
      institutionId: row.institutionId,
      quarter: row.quarter,
      previousQuarter: prevQ,
      previous13fDate: prevRange?.end ?? "",
      current13fDate: curRange?.end ?? "",
      previousPositionCount: prevTickers.size,
      matchedSecurities: matched,
      newPositionsExcluded: newExcluded,
      soldPositions: sold,
      portfolioStartingValue: prevSnap.totalPortfolioValue,
      weightedReturn: row.return,
    });
  }

  return out;
}

/**
 * Per-institution return quarters: only periods where this institution has a prior
 * 13F snapshot. Does not invent historical rows for missing filings.
 */
function returnQuartersForInstitution(
  byQuarter: Map<string, { totalPortfolioValue: number }>
): string[] {
  const snaps = sortQuarters(byQuarter.keys());
  const snapSet = new Set(snaps);
  const out: string[] = [];
  for (const q of snaps) {
    const prev = previousQuarter(q);
    if (prev && snapSet.has(prev)) out.push(q);
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
    const bySnap = portfolioIndex.get(institutionId);
    if (!bySnap) continue;

    const returnQuarters = returnQuartersForInstitution(bySnap);
    const byQuarter = new Map<string, number | null>();
    for (const quarter of returnQuarters) {
      // Explicit null when holdings exist for the pair but prices could not form a return
      const computed = qoqIndex.get(institutionId)?.get(quarter);
      byQuarter.set(quarter, computed ?? null);
    }

    const finiteVals = [...byQuarter.values()].filter(
      (r): r is number => r != null && Number.isFinite(r)
    );
    const bestQuarter =
      finiteVals.length > 0 ? Math.round(Math.max(...finiteVals) * 1_000_000) / 1_000_000 : null;
    const worstQuarter =
      finiteVals.length > 0 ? Math.round(Math.min(...finiteVals) * 1_000_000) / 1_000_000 : null;
    const latestQuarter = returnQuarters.filter((q) => {
      const r = byQuarter.get(q);
      return r != null && Number.isFinite(r);
    }).at(-1);

    for (const quarter of returnQuarters) {
      const qoq = byQuarter.get(quarter) ?? null;
      // Only emit quarters with a reconstructable return — never fabricate 0%
      if (qoq == null) continue;
      const isLatest = quarter === latestQuarter;

      summaries.push({
        institutionId,
        quarter,
        qoqReturn: qoq,
        rolling1yReturn: computeRolling1yReturn(byQuarter, quarter, options),
        ytdReturn: computeYtdReturn(byQuarter, quarter),
        consistencyScore: computeConsistencyThrough(byQuarter, quarter),
        volatility: computeVolatilityThrough(byQuarter, quarter, options),
        bestQuarter: isLatest ? bestQuarter : null,
        worstQuarter: isLatest ? worstQuarter : null,
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

export function computeInstitutionPerformanceWithDebug(
  holdings: InstitutionHolding[],
  returnsMatrix: ReturnsMatrix,
  quarters: string[],
  options: InstitutionPerformanceOptions = {}
): {
  summaries: InstitutionPerformanceSummary[];
  debug: QuarterPerformanceDebug[];
  institutionQuarterReturns: InstitutionQuarterPerformance[];
} {
  const portfolioSnapshots = buildPortfolioSnapshots(holdings);
  const portfolioIndex = indexPortfolioSnapshots(portfolioSnapshots);
  const institutionIds = [...portfolioIndex.keys()];
  const weightRows = buildPortfolioWeightRows(portfolioIndex, institutionIds, quarters);
  const institutionQuarterReturns = computePortfolioReturnsFromMatrix(weightRows, returnsMatrix);
  const summaries = computeInstitutionPerformanceSummaries(
    holdings,
    returnsMatrix,
    quarters,
    options
  );
  const debug = buildQuarterPerformanceDebug(
    portfolioIndex,
    returnsMatrix,
    institutionQuarterReturns
  );
  return { summaries, debug, institutionQuarterReturns };
}

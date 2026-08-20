import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadInstitutionHoldings } from "../performance/holdingsLoader.js";
import { SELECT_INSTITUTION_QUARTERS_BATCH_SQL } from "../performance/queries.js";
import { previousQuarter, sortQuarters } from "../performance/quarters.js";
import {
  SELECT_RECENT_FILING_QUARTERS_SQL,
  SELECT_STOCK_ENRICHMENT_SQL,
  trackedInstitutionCiks,
} from "./queries.js";
import type {
  MostAccumulatedPeriod,
  MostAccumulatedPeriodPayload,
  MostAccumulatedPayload,
  MostAccumulatedRow,
  MostAccumulatedSummary,
} from "./types.js";

/** Keep peak Node heap low on the 4GB VPS while covering the full tracked universe. */
const CIK_BATCH_SIZE = 120;

function roundShares(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

interface TickerAgg {
  ticker: string;
  institutionsBuying: number;
  netSharesAdded: number;
  previousTotalShares: number;
  currentTotalShares: number;
  reportedValueUsd: number;
}

interface PeriodMaps {
  currentLabel: string;
  previousLabel: string | null;
  available: boolean;
  unavailableReason: string | null;
  curByInstTicker: Map<string, number>;
  prevByInstTicker: Map<string, number>;
  valueByTicker: Map<string, number>;
}

interface PeriodAccumulator {
  currentLabel: string;
  previousLabel: string | null;
  available: boolean;
  unavailableReason: string | null;
  byTicker: Map<string, TickerAgg>;
  owningByTicker: Map<string, number>;
  priorByTicker: Map<string, TickerAgg>;
}

function instTickerKey(institutionId: string, ticker: string): string {
  return `${institutionId}::${ticker}`;
}

function periodLabel(period: MostAccumulatedPeriod): string {
  if (period === "30d") return "Last 30 days";
  if (period === "year") return "Last year";
  return "Last quarter";
}

function shiftQuartersBack(quarter: string, steps: number): string | null {
  let cursor: string | null = quarter;
  for (let i = 0; i < steps; i++) {
    if (!cursor) return null;
    cursor = previousQuarter(cursor);
  }
  return cursor;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function loadRecentFilingQuarters(
  pool: pg.Pool,
  ciks: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const batch of chunkArray(ciks, CIK_BATCH_SIZE)) {
    const res = await pool.query<{ institution_id: string; quarter: string }>(
      SELECT_RECENT_FILING_QUARTERS_SQL,
      [batch]
    );
    for (const row of res.rows) {
      out.set(String(row.institution_id), String(row.quarter));
    }
  }
  return out;
}

async function loadTrackedQuarters(pool: pg.Pool, ciks: string[]): Promise<string[]> {
  const quarters = new Set<string>();
  for (const batch of chunkArray(ciks, CIK_BATCH_SIZE)) {
    const res = await pool.query<{ quarter: string }>(SELECT_INSTITUTION_QUARTERS_BATCH_SQL, [batch]);
    for (const row of res.rows) quarters.add(String(row.quarter));
  }
  return sortQuarters([...quarters]).slice(-6);
}

function buildPeriodMaps(
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>,
  period: MostAccumulatedPeriod,
  quarters: string[],
  recentFilingQuarters: Map<string, string>
): PeriodMaps {
  const latestQuarter = quarters[quarters.length - 1] ?? "";
  const priorQuarter = quarters.length >= 2 ? quarters[quarters.length - 2] : null;
  const yearAgoQuarter =
    latestQuarter && quarters.length >= 5 ? shiftQuartersBack(latestQuarter, 4) : null;

  const curByInstTicker = new Map<string, number>();
  const prevByInstTicker = new Map<string, number>();
  const valueByTicker = new Map<string, number>();

  if (period === "30d") {
    if (!recentFilingQuarters.size) {
      return {
        currentLabel: "Last 30 days",
        previousLabel: null,
        available: false,
        unavailableReason: "No 13F filings were submitted in the last 30 days.",
        curByInstTicker,
        prevByInstTicker,
        valueByTicker,
      };
    }

    for (const h of holdings) {
      if (!h.ticker || h.shares == null || !Number.isFinite(h.shares)) continue;
      const instQuarter = recentFilingQuarters.get(h.institutionId);
      if (!instQuarter) continue;
      const prevQ = previousQuarter(instQuarter);
      const key = instTickerKey(h.institutionId, h.ticker);
      if (h.quarter === instQuarter) {
        curByInstTicker.set(key, (curByInstTicker.get(key) ?? 0) + h.shares);
        valueByTicker.set(h.ticker, (valueByTicker.get(h.ticker) ?? 0) + h.marketValue);
      } else if (prevQ && h.quarter === prevQ) {
        prevByInstTicker.set(key, (prevByInstTicker.get(key) ?? 0) + h.shares);
      }
    }

    const filingDates = [...recentFilingQuarters.values()];
    const uniqueQuarters = sortQuarters(filingDates);
    return {
      currentLabel: `Filings in last 30 days (${uniqueQuarters.join(", ") || "—"})`,
      previousLabel: uniqueQuarters.map((q) => previousQuarter(q)).filter(Boolean).join(", ") || null,
      available: true,
      unavailableReason: null,
      curByInstTicker,
      prevByInstTicker,
      valueByTicker,
    };
  }

  const currentQuarter = latestQuarter;
  const previousQ = period === "year" ? yearAgoQuarter : priorQuarter;

  if (!currentQuarter || !previousQ) {
    return {
      currentLabel: currentQuarter || "—",
      previousLabel: previousQ,
      available: false,
      unavailableReason:
        period === "year"
          ? "At least five quarters of 13F data are required for year-over-year comparison."
          : "At least two quarters of 13F data are required.",
      curByInstTicker,
      prevByInstTicker,
      valueByTicker,
    };
  }

  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares)) continue;
    const key = instTickerKey(h.institutionId, h.ticker);
    if (h.quarter === currentQuarter) {
      curByInstTicker.set(key, (curByInstTicker.get(key) ?? 0) + h.shares);
      valueByTicker.set(h.ticker, (valueByTicker.get(h.ticker) ?? 0) + h.marketValue);
    } else if (h.quarter === previousQ) {
      prevByInstTicker.set(key, (prevByInstTicker.get(key) ?? 0) + h.shares);
    }
  }

  return {
    currentLabel: currentQuarter,
    previousLabel: previousQ,
    available: true,
    unavailableReason: null,
    curByInstTicker,
    prevByInstTicker,
    valueByTicker,
  };
}

function aggregateTickers(
  curByInstTicker: Map<string, number>,
  prevByInstTicker: Map<string, number>,
  valueByTicker: Map<string, number>
): Map<string, TickerAgg> {
  const keys = new Set([...curByInstTicker.keys(), ...prevByInstTicker.keys()]);
  const byTicker = new Map<string, TickerAgg>();

  for (const key of keys) {
    const ticker = key.split("::")[1];
    if (!ticker) continue;
    const cur = curByInstTicker.get(key) ?? 0;
    const prev = prevByInstTicker.get(key) ?? 0;
    const delta = cur - prev;

    let row = byTicker.get(ticker);
    if (!row) {
      row = {
        ticker,
        institutionsBuying: 0,
        netSharesAdded: 0,
        previousTotalShares: 0,
        currentTotalShares: 0,
        reportedValueUsd: valueByTicker.get(ticker) ?? 0,
      };
      byTicker.set(ticker, row);
    }

    row.netSharesAdded = roundShares(row.netSharesAdded + delta);
    row.previousTotalShares = roundShares(row.previousTotalShares + prev);
    row.currentTotalShares = roundShares(row.currentTotalShares + cur);
    if (delta > 0) row.institutionsBuying += 1;
  }

  return byTicker;
}

function countOwningByTicker(curByInstTicker: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, shares] of curByInstTicker) {
    if (shares <= 0) continue;
    const ticker = key.split("::")[1];
    if (!ticker) continue;
    out.set(ticker, (out.get(ticker) ?? 0) + 1);
  }
  return out;
}

function mergeTickerAggs(into: Map<string, TickerAgg>, from: Map<string, TickerAgg>): void {
  for (const [ticker, row] of from) {
    const prev = into.get(ticker);
    if (!prev) {
      into.set(ticker, { ...row });
      continue;
    }
    prev.institutionsBuying += row.institutionsBuying;
    prev.netSharesAdded = roundShares(prev.netSharesAdded + row.netSharesAdded);
    prev.previousTotalShares = roundShares(prev.previousTotalShares + row.previousTotalShares);
    prev.currentTotalShares = roundShares(prev.currentTotalShares + row.currentTotalShares);
    prev.reportedValueUsd = roundShares(prev.reportedValueUsd + row.reportedValueUsd);
  }
}

function mergeCounts(into: Map<string, number>, from: Map<string, number>): void {
  for (const [ticker, n] of from) {
    into.set(ticker, (into.get(ticker) ?? 0) + n);
  }
}

function aggregatePriorPeriod(
  holdings: Awaited<ReturnType<typeof loadInstitutionHoldings>>,
  period: MostAccumulatedPeriod,
  quarters: string[]
): Map<string, TickerAgg> {
  const shiftedQuarters = [...quarters];
  if (shiftedQuarters.length > 1) shiftedQuarters.pop();

  if (period === "30d" || !shiftedQuarters.length) return new Map();

  const shiftedLatest = shiftedQuarters[shiftedQuarters.length - 1] ?? "";
  const shiftedPrev =
    period === "year" ? shiftQuartersBack(shiftedLatest, 4) : previousQuarter(shiftedLatest);
  if (!shiftedLatest || !shiftedPrev) return new Map();

  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const h of holdings) {
    if (!h.ticker || h.shares == null || !Number.isFinite(h.shares)) continue;
    const key = instTickerKey(h.institutionId, h.ticker);
    if (h.quarter === shiftedLatest) {
      cur.set(key, (cur.get(key) ?? 0) + h.shares);
    } else if (h.quarter === shiftedPrev) {
      prev.set(key, (prev.get(key) ?? 0) + h.shares);
    }
  }

  return aggregateTickers(cur, prev, new Map());
}

function buildSummary(rows: MostAccumulatedRow[]): MostAccumulatedSummary {
  const top = rows[0] ?? null;
  const pctValues = rows
    .map((r) => r.percentIncrease)
    .filter((v): v is number => v != null && Number.isFinite(v));
  return {
    topStock: top
      ? { ticker: top.ticker, companyName: top.companyName, netSharesAdded: top.netSharesAdded }
      : null,
    totalInstitutionsBuying: rows.reduce((sum, r) => sum + r.institutionsBuying, 0),
    totalNetSharesAdded: roundShares(rows.reduce((sum, r) => sum + r.netSharesAdded, 0)),
    averagePercentIncrease:
      pctValues.length > 0
        ? roundPct(pctValues.reduce((a, b) => a + b, 0) / pctValues.length)
        : null,
  };
}

async function loadStockEnrichment(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  for (const batch of chunkArray(tickers, 500)) {
    const res = await pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
    }>(SELECT_STOCK_ENRICHMENT_SQL, [batch]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        companyName: row.company_name ? String(row.company_name) : null,
        sector: row.sector ? String(row.sector) : null,
      });
    }
  }
  return out;
}

function finalizeRows(
  byTicker: Map<string, TickerAgg>,
  owningByTicker: Map<string, number>,
  enrichment: Map<string, { companyName: string | null; sector: string | null }>,
  priorTop10: Set<string>
): MostAccumulatedRow[] {
  const rows: MostAccumulatedRow[] = [];
  const sorted = [...byTicker.values()].sort((a, b) => b.netSharesAdded - a.netSharesAdded);
  const top10 = new Set(sorted.slice(0, 10).map((r) => r.ticker));

  for (const row of sorted) {
    const percentIncrease =
      row.previousTotalShares > 0
        ? roundPct((row.netSharesAdded / row.previousTotalShares) * 100)
        : row.netSharesAdded > 0
          ? null
          : row.netSharesAdded < 0
            ? roundPct(
                (row.netSharesAdded /
                  Math.max(row.previousTotalShares || row.currentTotalShares, 1)) *
                  100
              )
            : 0;
    const meta = enrichment.get(row.ticker);
    rows.push({
      ticker: row.ticker,
      companyName: meta?.companyName ?? null,
      sector: meta?.sector ?? null,
      institutionsBuying: row.institutionsBuying,
      netSharesAdded: row.netSharesAdded,
      percentIncrease,
      totalInstitutionsOwning: owningByTicker.get(row.ticker) ?? 0,
      previousTotalShares: row.previousTotalShares,
      currentTotalShares: row.currentTotalShares,
      reportedValueUsd: roundShares(row.reportedValueUsd),
      isNewTop10: top10.has(row.ticker) && !priorTop10.has(row.ticker),
      highlightManyInstitutions: row.institutionsBuying > 100,
      highlightHighIncrease: percentIncrease != null && percentIncrease > 25,
    });
  }
  return rows;
}

function emptyAccumulator(period: MostAccumulatedPeriod): PeriodAccumulator {
  return {
    currentLabel: period === "30d" ? "Last 30 days" : "—",
    previousLabel: null,
    available: false,
    unavailableReason: "No data",
    byTicker: new Map(),
    owningByTicker: new Map(),
    priorByTicker: new Map(),
  };
}

function buildPeriodPayload(
  period: MostAccumulatedPeriod,
  acc: PeriodAccumulator,
  enrichment: Map<string, { companyName: string | null; sector: string | null }>
): MostAccumulatedPeriodPayload {
  if (!acc.available) {
    return {
      period,
      periodLabel: periodLabel(period),
      currentPeriod: acc.currentLabel,
      previousPeriod: acc.previousLabel,
      available: false,
      unavailableReason: acc.unavailableReason,
      summary: {
        topStock: null,
        totalInstitutionsBuying: 0,
        totalNetSharesAdded: 0,
        averagePercentIncrease: null,
      },
      stocks: [],
    };
  }

  const priorTop10 = new Set(
    [...acc.priorByTicker.values()]
      .sort((a, b) => b.netSharesAdded - a.netSharesAdded)
      .slice(0, 10)
      .map((r) => r.ticker)
  );
  const stocks = finalizeRows(acc.byTicker, acc.owningByTicker, enrichment, priorTop10);

  return {
    period,
    periodLabel: periodLabel(period),
    currentPeriod: acc.currentLabel,
    previousPeriod: acc.previousLabel,
    available: true,
    unavailableReason: null,
    summary: buildSummary(stocks),
    stocks,
  };
}

/**
 * Full tracked-universe ranking. Holdings are loaded in CIK batches so the warm
 * job fits in ~3GB heap (loading all filers at once OOMs the production VPS).
 */
export async function computeMostAccumulated(
  pool: pg.Pool = getPool()
): Promise<MostAccumulatedPayload> {
  const ciks = trackedInstitutionCiks();
  const [quarters, recentFilingQuarters] = await Promise.all([
    loadTrackedQuarters(pool, ciks),
    loadRecentFilingQuarters(pool, ciks),
  ]);

  const periods = ["quarter", "30d", "year"] as const;
  const accumulators = Object.fromEntries(
    periods.map((p) => [p, emptyAccumulator(p)])
  ) as Record<MostAccumulatedPeriod, PeriodAccumulator>;

  const tickerSet = new Set<string>();
  const batches = chunkArray(ciks, CIK_BATCH_SIZE);
  let batchIndex = 0;

  for (const batch of batches) {
    batchIndex += 1;
    if (batchIndex === 1 || batchIndex === batches.length || batchIndex % 10 === 0) {
      console.log(`Most-accumulated: holdings batch ${batchIndex}/${batches.length} (${batch.length} CIKs)`);
    }

    const holdings = await loadInstitutionHoldings(pool, batch, { maxQuarters: 6 });
    for (const h of holdings) {
      if (h.ticker) tickerSet.add(h.ticker);
    }

    for (const period of periods) {
      const ctx = buildPeriodMaps(holdings, period, quarters, recentFilingQuarters);
      const acc = accumulators[period];
      acc.currentLabel = ctx.currentLabel;
      acc.previousLabel = ctx.previousLabel;
      acc.available = ctx.available;
      acc.unavailableReason = ctx.unavailableReason;
      if (!ctx.available) continue;

      mergeTickerAggs(
        acc.byTicker,
        aggregateTickers(ctx.curByInstTicker, ctx.prevByInstTicker, ctx.valueByTicker)
      );
      mergeCounts(acc.owningByTicker, countOwningByTicker(ctx.curByInstTicker));
      mergeTickerAggs(acc.priorByTicker, aggregatePriorPeriod(holdings, period, quarters));
    }
  }

  const enrichment = await loadStockEnrichment(pool, [...tickerSet]);
  const periodPayloads = {} as Record<MostAccumulatedPeriod, MostAccumulatedPeriodPayload>;
  for (const period of periods) {
    periodPayloads[period] = buildPeriodPayload(period, accumulators[period], enrichment);
  }

  const sectors = [
    ...new Set(
      [...enrichment.values()]
        .map((r) => r.sector)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    computedAt: new Date().toISOString(),
    sectors,
    periods: periodPayloads,
  };
}

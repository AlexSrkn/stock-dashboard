import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getStocksRepository } from "./stocksRepository.js";

const CACHE_TTL_MS = 30 * 60 * 1000;

/** Industry must have this many constituents to appear in ranked tables. */
const MIN_INDUSTRY_COMPANIES = 5;
/** Minimum valid company observations before a group metric is emitted. */
const MIN_METRIC_OBSERVATIONS = 3;

/** Absolute floors so near-zero priors cannot explode % changes. */
const REVENUE_PREV_MIN_USD = 100_000;
const REVENUE_FOR_MARGIN_MIN_USD = 100_000;
const FCF_PREV_ABS_MIN_USD = 100_000;
const EPS_PREV_ABS_MIN = 0.05;
const SUM_REVENUE_PREV_MIN_USD = 1_000_000;
const SUM_FCF_PREV_MIN_USD = 1_000_000;

/** Drop pathological company / aggregate growth rates. */
const EPS_GROWTH_ABS_MAX_PCT = 500;
const SUMMED_GROWTH_ABS_MAX_PCT = 200;

/** Annualize single-quarter return rates for cross-sector comparison. */
const QUARTER_ANNUALIZE = 4;
/** Exclude absurd annualized return outliers from medians. */
const RETURN_ANN_ABS_MAX_PCT = 200;
/** QoQ return/margin deltas beyond this (pp) are treated as distorted. */
const LEVEL_QOQ_ABS_MAX_PP = 50;
/** Operating margins beyond this are almost always near-zero revenue artifacts. */
const OPERATING_MARGIN_ABS_MAX_PCT = 100;
/** Exclude non-economic D/E outliers (Financials suppressed entirely). */
const DEBT_EQUITY_MAX = 50;

export interface SectorFundamentalsMetricObs {
  revenueGrowthQoq: number;
  epsGrowthQoq: number;
  fcfGrowthQoq: number;
  operatingMargin: number;
  operatingMarginQoq: number;
  roic: number;
  roicQoq: number;
  roe: number;
  roeQoq: number;
  debtEquity: number;
  debtEquityQoq: number;
}

export interface SectorFundamentalsMetrics {
  companyCount: number;
  revenueGrowthQoq: number | null;
  epsGrowthQoq: number | null;
  fcfGrowthQoq: number | null;
  operatingMargin: number | null;
  operatingMarginQoq: number | null;
  roic: number | null;
  roicQoq: number | null;
  roe: number | null;
  roeQoq: number | null;
  debtEquity: number | null;
  debtEquityQoq: number | null;
  sumRevenueUsd: number | null;
  sumRevenuePrevUsd: number | null;
  sumFcfUsd: number | null;
  sumFcfPrevUsd: number | null;
  /** Count of valid company observations behind each metric (0 = unavailable). */
  metricObs: SectorFundamentalsMetricObs;
}

export interface SectorFundamentalsSectorRow extends SectorFundamentalsMetrics {
  sector: string;
  sectorSlug: string;
  industryCount: number;
}

export interface SectorFundamentalsIndustryRow extends SectorFundamentalsMetrics {
  sector: string;
  sectorSlug: string;
  industry: string;
  industrySlug: string;
}

export interface SectorFundamentalsPayload {
  computedAt: string;
  currentPeriodLabel: string | null;
  previousPeriodLabel: string | null;
  summary: {
    sectorCount: number;
    industryCount: number;
    companyCount: number;
    topRevenueGrowth: { name: string; value: number } | null;
  };
  sectors: SectorFundamentalsSectorRow[];
  industries: SectorFundamentalsIndustryRow[];
}

function slug(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function round2(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePeriodLabel(label: string | null | undefined): { fp: number; fy: number } | null {
  if (!label) return null;
  const m = /^Q([1-4])\s+(\d{4})$/i.exec(String(label).trim());
  if (!m) return null;
  return { fp: Number(m[1]), fy: Number(m[2]) };
}

/** True when prev is the fiscal quarter immediately before cur (QoQ). */
export function isConsecutiveQuarter(
  curLabel: string | null | undefined,
  prevLabel: string | null | undefined
): boolean {
  const cur = parsePeriodLabel(curLabel);
  const prev = parsePeriodLabel(prevLabel);
  if (!cur || !prev) return false;
  if (cur.fp === 1) return prev.fp === 4 && prev.fy === cur.fy - 1;
  return prev.fp === cur.fp - 1 && prev.fy === cur.fy;
}

function isFinancialsSector(sector: string): boolean {
  return String(sector || "").trim().toLowerCase() === "financials";
}

function emptyMetricObs(): SectorFundamentalsMetricObs {
  return {
    revenueGrowthQoq: 0,
    epsGrowthQoq: 0,
    fcfGrowthQoq: 0,
    operatingMargin: 0,
    operatingMarginQoq: 0,
    roic: 0,
    roicQoq: 0,
    roe: 0,
    roeQoq: 0,
    debtEquity: 0,
    debtEquityQoq: 0,
  };
}

/**
 * Aggregated growth from summed levels: (Σcur − Σprev) / Σprev.
 * Returns null for non-positive/near-zero priors, sign changes, or extreme %.
 */
function summedGrowthPctPositiveBase(
  sumCur: number,
  sumPrev: number,
  absMinPrev: number
): number | null {
  if (!Number.isFinite(sumCur) || !Number.isFinite(sumPrev)) return null;
  if (!(sumPrev >= absMinPrev)) return null;
  // Sign change vs a positive base is not a stable growth rate for ranking.
  if (sumCur < 0) return null;
  const growth = ((sumCur - sumPrev) / sumPrev) * 100;
  if (!Number.isFinite(growth) || Math.abs(growth) > SUMMED_GROWTH_ABS_MAX_PCT) return null;
  return round2(growth);
}

/**
 * Company-level growth. Requires a positive material prior; rejects sign changes
 * and extreme percentages so they never enter medians as zeros or outliers.
 */
function companyGrowthPct(
  cur: number | null,
  prev: number | null,
  absMinPrev: number,
  absMaxPct: number
): number | null {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (!(prev >= absMinPrev)) return null;
  if (cur < 0) return null;
  const growth = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(growth) || Math.abs(growth) > absMaxPct) return null;
  return round2(growth);
}

/** Median, or null when fewer than `minObs` finite values (never coerce to 0). */
function median(values: number[], minObs = MIN_METRIC_OBSERVATIONS): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < minObs) return null;
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 1) return round2(xs[mid]!);
  return round2((xs[mid - 1]! + xs[mid]!) / 2);
}

/**
 * Single-quarter return annualized for sector comparison.
 * ROE = NI / equity; ROIC = operating income / (equity + total debt).
 */
function annualizedReturnPct(
  income: number | null,
  capital: number | null
): number | null {
  if (income == null || capital == null || !Number.isFinite(income) || !Number.isFinite(capital)) {
    return null;
  }
  if (!(capital > 0)) return null;
  const ann = (income / capital) * 100 * QUARTER_ANNUALIZE;
  if (!Number.isFinite(ann) || Math.abs(ann) > RETURN_ANN_ABS_MAX_PCT) return null;
  return round2(ann);
}

function validOperatingMargin(
  margin: number | null,
  revenue: number | null
): number | null {
  if (margin == null || !Number.isFinite(margin)) return null;
  if (revenue == null || !(revenue >= REVENUE_FOR_MARGIN_MIN_USD)) return null;
  if (Math.abs(margin) > OPERATING_MARGIN_ABS_MAX_PCT) return null;
  return round2(margin);
}

function validDebtEquity(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0 || value > DEBT_EQUITY_MAX) return null;
  return round2(value);
}

function validLevelDelta(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (!Number.isFinite(d) || Math.abs(d) > LEVEL_QOQ_ABS_MAX_PP) return null;
  return round2(d);
}

interface StockFundRow {
  ticker: string;
  sector: string;
  industry: string | null;
  curLabel: string | null;
  prevLabel: string | null;
  revenue: number | null;
  revenuePrev: number | null;
  fcf: number | null;
  fcfPrev: number | null;
  eps: number | null;
  epsPrev: number | null;
  operatingMargin: number | null;
  operatingMarginPrev: number | null;
  /** Annualized quarterly ROE (%). */
  roe: number | null;
  roePrev: number | null;
  debtEquity: number | null;
  debtEquityPrev: number | null;
  /** Annualized quarterly ROIC (%). */
  roic: number | null;
  roicPrev: number | null;
}

function periodLabel(fy: string | number | null | undefined, fp: string | null | undefined): string | null {
  if (fy == null || !fp) return null;
  return `${fp} ${fy}`;
}

function modeLabel(labels: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const label of labels) {
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [label, n] of counts) {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  }
  return best;
}

async function loadStockFundamentalsPair(pool: pg.Pool): Promise<StockFundRow[]> {
  const res = await pool.query<{
    ticker: string;
    sector: string;
    industry: string | null;
    fiscal_year: string | number | null;
    fiscal_period: string | null;
    fiscal_year_prev: string | number | null;
    fiscal_period_prev: string | null;
    revenue: string | number | null;
    revenue_prev: string | number | null;
    fcf: string | number | null;
    fcf_prev: string | number | null;
    eps: string | number | null;
    eps_prev: string | number | null;
    operating_margin: string | number | null;
    operating_margin_prev: string | number | null;
    debt_equity: string | number | null;
    debt_equity_prev: string | number | null;
    operating_income: string | number | null;
    operating_income_prev: string | number | null;
    net_income: string | number | null;
    net_income_prev: string | number | null;
    equity: string | number | null;
    equity_prev: string | number | null;
    total_debt: string | number | null;
    total_debt_prev: string | number | null;
  }>(
    `
    WITH ranked AS (
      SELECT
        UPPER(BTRIM(fp.ticker)) AS ticker,
        fp.period_end,
        fp.fiscal_year,
        fp.fiscal_period,
        fp.metrics,
        fp.derived_metrics,
        ROW_NUMBER() OVER (
          PARTITION BY UPPER(BTRIM(fp.ticker))
          ORDER BY fp.period_end DESC, fp.filed_date DESC
        ) AS rn
      FROM sec_financial_period fp
      WHERE fp.ticker IS NOT NULL
        AND BTRIM(fp.ticker) <> ''
        AND fp.statement_scope = 'quarterly'
        AND fp.fiscal_period IN ('Q1', 'Q2', 'Q3', 'Q4')
    ),
    cur AS (
      SELECT * FROM ranked WHERE rn = 1
    ),
    prev AS (
      SELECT * FROM ranked WHERE rn = 2
    )
    SELECT
      c.ticker,
      st.sector,
      st.industry,
      c.fiscal_year,
      c.fiscal_period,
      p.fiscal_year AS fiscal_year_prev,
      p.fiscal_period AS fiscal_period_prev,
      NULLIF((c.metrics->>'revenue')::float8, 'NaN'::float8) AS revenue,
      NULLIF((p.metrics->>'revenue')::float8, 'NaN'::float8) AS revenue_prev,
      COALESCE(
        NULLIF((c.derived_metrics->>'free_cash_flow')::float8, 'NaN'::float8),
        NULLIF((c.metrics->>'free_cash_flow')::float8, 'NaN'::float8)
      ) AS fcf,
      COALESCE(
        NULLIF((p.derived_metrics->>'free_cash_flow')::float8, 'NaN'::float8),
        NULLIF((p.metrics->>'free_cash_flow')::float8, 'NaN'::float8)
      ) AS fcf_prev,
      COALESCE(
        NULLIF((c.metrics->>'eps_diluted')::float8, 'NaN'::float8),
        NULLIF((c.metrics->>'eps_basic')::float8, 'NaN'::float8)
      ) AS eps,
      COALESCE(
        NULLIF((p.metrics->>'eps_diluted')::float8, 'NaN'::float8),
        NULLIF((p.metrics->>'eps_basic')::float8, 'NaN'::float8)
      ) AS eps_prev,
      NULLIF((c.derived_metrics->>'operating_margin')::float8, 'NaN'::float8) AS operating_margin,
      NULLIF((p.derived_metrics->>'operating_margin')::float8, 'NaN'::float8) AS operating_margin_prev,
      NULLIF((c.derived_metrics->>'debt_to_equity')::float8, 'NaN'::float8) AS debt_equity,
      NULLIF((p.derived_metrics->>'debt_to_equity')::float8, 'NaN'::float8) AS debt_equity_prev,
      NULLIF((c.metrics->>'operating_income')::float8, 'NaN'::float8) AS operating_income,
      NULLIF((p.metrics->>'operating_income')::float8, 'NaN'::float8) AS operating_income_prev,
      NULLIF((c.metrics->>'net_income')::float8, 'NaN'::float8) AS net_income,
      NULLIF((p.metrics->>'net_income')::float8, 'NaN'::float8) AS net_income_prev,
      NULLIF((c.metrics->>'shareholder_equity')::float8, 'NaN'::float8) AS equity,
      NULLIF((p.metrics->>'shareholder_equity')::float8, 'NaN'::float8) AS equity_prev,
      COALESCE(
        NULLIF((c.derived_metrics->>'total_debt')::float8, 'NaN'::float8),
        NULLIF((c.metrics->>'total_debt')::float8, 'NaN'::float8)
      ) AS total_debt,
      COALESCE(
        NULLIF((p.derived_metrics->>'total_debt')::float8, 'NaN'::float8),
        NULLIF((p.metrics->>'total_debt')::float8, 'NaN'::float8)
      ) AS total_debt_prev
    FROM cur c
    INNER JOIN stocks st ON st.ticker = c.ticker
    LEFT JOIN prev p ON p.ticker = c.ticker
    WHERE st.sector IS NOT NULL AND BTRIM(st.sector) <> ''
    `
  );

  return res.rows.map((row) => {
    const oi = num(row.operating_income);
    const ni = num(row.net_income);
    const eq = num(row.equity);
    const debt = num(row.total_debt);
    const oiPrev = num(row.operating_income_prev);
    const niPrev = num(row.net_income_prev);
    const eqPrev = num(row.equity_prev);
    const debtPrev = num(row.total_debt_prev);
    const revenue = num(row.revenue);
    const revenuePrev = num(row.revenue_prev);

    const investedCapital = (equity: number | null, totalDebt: number | null): number | null => {
      if (equity == null || !(equity > 0)) return null;
      const d = totalDebt != null && totalDebt > 0 ? totalDebt : 0;
      return equity + d;
    };

    const financials = isFinancialsSector(String(row.sector));
    const roic = financials ? null : annualizedReturnPct(oi, investedCapital(eq, debt));
    const roicPrev = financials
      ? null
      : annualizedReturnPct(oiPrev, investedCapital(eqPrev, debtPrev));
    const roe = annualizedReturnPct(ni, eq);
    const roePrev = annualizedReturnPct(niPrev, eqPrev);

    return {
      ticker: String(row.ticker).toUpperCase(),
      sector: String(row.sector),
      industry: row.industry ? String(row.industry) : null,
      curLabel: periodLabel(row.fiscal_year, row.fiscal_period),
      prevLabel: periodLabel(row.fiscal_year_prev, row.fiscal_period_prev),
      revenue,
      revenuePrev,
      fcf: num(row.fcf),
      fcfPrev: num(row.fcf_prev),
      eps: num(row.eps),
      epsPrev: num(row.eps_prev),
      operatingMargin: validOperatingMargin(num(row.operating_margin), revenue),
      operatingMarginPrev: validOperatingMargin(num(row.operating_margin_prev), revenuePrev),
      roe,
      roePrev,
      debtEquity: financials ? null : validDebtEquity(num(row.debt_equity)),
      debtEquityPrev: financials ? null : validDebtEquity(num(row.debt_equity_prev)),
      roic,
      roicPrev,
    };
  });
}

/**
 * Sector/industry aggregation with shared validation:
 * - null = unavailable / insufficient / invalid (never coerced to 0)
 * - growth from paired consecutive SUMS with positive material prior
 * - levels/ratios = median of validated company values (≥ MIN_METRIC_OBSERVATIONS)
 * - Financials: D/E and ROIC not applicable
 */
function aggregateGroup(rows: StockFundRow[]): SectorFundamentalsMetrics {
  const companyCount = rows.length;
  const financials = rows.length > 0 && isFinancialsSector(rows[0]!.sector);
  const metricObs = emptyMetricObs();

  let sumRevenue = 0;
  let sumRevenuePrev = 0;
  let revenuePairs = 0;
  let sumFcf = 0;
  let sumFcfPrev = 0;
  let fcfPairs = 0;

  const epsGrowths: number[] = [];
  const opMargins: number[] = [];
  const opMarginDeltas: number[] = [];
  const roics: number[] = [];
  const roicDeltas: number[] = [];
  const roes: number[] = [];
  const roeDeltas: number[] = [];
  const des: number[] = [];
  const deDeltas: number[] = [];

  for (const r of rows) {
    const consecutive = isConsecutiveQuarter(r.curLabel, r.prevLabel);

    if (
      consecutive &&
      r.revenue != null &&
      r.revenuePrev != null &&
      r.revenuePrev >= REVENUE_PREV_MIN_USD
    ) {
      sumRevenue += r.revenue;
      sumRevenuePrev += r.revenuePrev;
      revenuePairs += 1;
    }

    if (
      consecutive &&
      r.fcf != null &&
      r.fcfPrev != null &&
      Math.abs(r.fcfPrev) >= FCF_PREV_ABS_MIN_USD
    ) {
      sumFcf += r.fcf;
      sumFcfPrev += r.fcfPrev;
      fcfPairs += 1;
    }

    if (consecutive) {
      const epsG = companyGrowthPct(r.eps, r.epsPrev, EPS_PREV_ABS_MIN, EPS_GROWTH_ABS_MAX_PCT);
      if (epsG != null) epsGrowths.push(epsG);
    }

    if (r.operatingMargin != null) opMargins.push(r.operatingMargin);
    if (!financials && r.roic != null) roics.push(r.roic);
    if (r.roe != null) roes.push(r.roe);
    if (!financials && r.debtEquity != null) des.push(r.debtEquity);

    if (consecutive) {
      const omDelta = validLevelDelta(r.operatingMargin, r.operatingMarginPrev);
      if (omDelta != null) opMarginDeltas.push(omDelta);

      if (!financials) {
        const roicDelta = validLevelDelta(r.roic, r.roicPrev);
        if (roicDelta != null) roicDeltas.push(roicDelta);
      }

      const roeDelta = validLevelDelta(r.roe, r.roePrev);
      if (roeDelta != null) roeDeltas.push(roeDelta);

      if (!financials) {
        const deDelta = validLevelDelta(r.debtEquity, r.debtEquityPrev);
        // D/E deltas use ratio points; reuse pp cap as a distortion guard.
        if (deDelta != null) deDeltas.push(deDelta);
      }
    }
  }

  metricObs.revenueGrowthQoq = revenuePairs;
  metricObs.fcfGrowthQoq = fcfPairs;
  metricObs.epsGrowthQoq = epsGrowths.length;
  metricObs.operatingMargin = opMargins.length;
  metricObs.operatingMarginQoq = opMarginDeltas.length;
  metricObs.roic = roics.length;
  metricObs.roicQoq = roicDeltas.length;
  metricObs.roe = roes.length;
  metricObs.roeQoq = roeDeltas.length;
  metricObs.debtEquity = des.length;
  metricObs.debtEquityQoq = deDeltas.length;

  const revenueGrowthQoq =
    revenuePairs >= MIN_METRIC_OBSERVATIONS
      ? summedGrowthPctPositiveBase(sumRevenue, sumRevenuePrev, SUM_REVENUE_PREV_MIN_USD)
      : null;
  const fcfGrowthQoq =
    fcfPairs >= MIN_METRIC_OBSERVATIONS
      ? summedGrowthPctPositiveBase(sumFcf, sumFcfPrev, SUM_FCF_PREV_MIN_USD)
      : null;

  return {
    companyCount,
    revenueGrowthQoq,
    epsGrowthQoq: median(epsGrowths),
    fcfGrowthQoq,
    operatingMargin: median(opMargins),
    operatingMarginQoq: median(opMarginDeltas),
    roic: financials ? null : median(roics),
    roicQoq: financials ? null : median(roicDeltas),
    roe: median(roes),
    roeQoq: median(roeDeltas),
    debtEquity: financials ? null : median(des),
    debtEquityQoq: financials ? null : median(deDeltas),
    sumRevenueUsd: revenuePairs > 0 ? round2(sumRevenue) : null,
    sumRevenuePrevUsd: revenuePairs > 0 ? round2(sumRevenuePrev) : null,
    sumFcfUsd: fcfPairs > 0 ? round2(sumFcf) : null,
    sumFcfPrevUsd: fcfPairs > 0 ? round2(sumFcfPrev) : null,
    metricObs,
  };
}

let cache: { at: number; payload: SectorFundamentalsPayload } | null = null;
let inflight: Promise<SectorFundamentalsPayload> | null = null;

function emptyPayload(): SectorFundamentalsPayload {
  return {
    computedAt: new Date().toISOString(),
    currentPeriodLabel: null,
    previousPeriodLabel: null,
    summary: {
      sectorCount: 0,
      industryCount: 0,
      companyCount: 0,
      topRevenueGrowth: null,
    },
    sectors: [],
    industries: [],
  };
}

async function computeSectorFundamentals(pool: pg.Pool): Promise<SectorFundamentalsPayload> {
  await getStocksRepository().ensureSchema();
  const stocks = await loadStockFundamentalsPair(pool);
  if (!stocks.length) return emptyPayload();

  const bySector = new Map<string, StockFundRow[]>();
  const byIndustry = new Map<string, StockFundRow[]>();

  for (const row of stocks) {
    if (!bySector.has(row.sector)) bySector.set(row.sector, []);
    bySector.get(row.sector)!.push(row);
    if (row.industry) {
      const key = `${row.sector}::${row.industry}`;
      if (!byIndustry.has(key)) byIndustry.set(key, []);
      byIndustry.get(key)!.push(row);
    }
  }

  const sectors: SectorFundamentalsSectorRow[] = [...bySector.entries()]
    .map(([sector, rows]) => {
      const industries = new Set(rows.map((r) => r.industry).filter(Boolean));
      return {
        sector,
        sectorSlug: slug(sector),
        industryCount: industries.size,
        ...aggregateGroup(rows),
      };
    })
    .sort((a, b) => a.sector.localeCompare(b.sector));

  const industries: SectorFundamentalsIndustryRow[] = [...byIndustry.entries()]
    .map(([, rows]) => {
      const sector = rows[0]!.sector;
      const industry = rows[0]!.industry || "Unclassified";
      return {
        sector,
        sectorSlug: slug(sector),
        industry,
        industrySlug: slug(industry),
        ...aggregateGroup(rows),
      };
    })
    .filter((row) => row.companyCount >= MIN_INDUSTRY_COMPANIES)
    .sort(
      (a, b) =>
        a.sector.localeCompare(b.sector) || a.industry.localeCompare(b.industry)
    );

  const top = [...sectors]
    .filter((s) => s.revenueGrowthQoq != null)
    .sort((a, b) => (b.revenueGrowthQoq ?? -Infinity) - (a.revenueGrowthQoq ?? -Infinity))[0];

  return {
    computedAt: new Date().toISOString(),
    currentPeriodLabel: modeLabel(stocks.map((s) => s.curLabel)),
    previousPeriodLabel: modeLabel(
      stocks
        .filter((s) => isConsecutiveQuarter(s.curLabel, s.prevLabel))
        .map((s) => s.prevLabel)
    ),
    summary: {
      sectorCount: sectors.length,
      industryCount: industries.length,
      companyCount: stocks.length,
      topRevenueGrowth: top
        ? { name: top.sector, value: top.revenueGrowthQoq as number }
        : null,
    },
    sectors,
    industries,
  };
}

export function clearSectorFundamentalsCache(): void {
  cache = null;
  inflight = null;
}

export async function loadSectorFundamentals(
  pool: pg.Pool = getPool()
): Promise<SectorFundamentalsPayload> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const payload = await computeSectorFundamentals(pool);
      cache = { at: Date.now(), payload };
      return payload;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

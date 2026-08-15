import type {
  DerivedMetricKey,
  FinancialMetricKey,
  FinancialPeriodRow,
  MetricValueDetail,
} from "./types.js";
import { classifyDebtTag, resolveTotalDebt, type TotalDebtResolution } from "./debtResolve.js";
import { resolveReturnMetricsForRow } from "./returnMetrics.js";
import { isYtdDurationBucket, parseIsoDate } from "./periodUtils.js";

function parseEndMs(end: string | null | undefined): number | null {
  const d = parseIsoDate(end);
  if (!d) return null;
  const ms = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Match same fiscal quarter ~1 year earlier by period end (SEC fy can mislabel). */
function findPriorYearQuarterRow(
  rows: FinancialPeriodRow[],
  row: FinancialPeriodRow
): FinancialPeriodRow | undefined {
  if (!row.fp || row.fp === "FY" || !row.end) return undefined;
  const endMs = parseEndMs(row.end);
  if (endMs == null) return undefined;

  const targetMs = endMs - 364 * 86_400_000;
  const windowMs = 50 * 86_400_000;
  const candidates = rows.filter((other) => {
    if (other.fp !== row.fp || !other.end) return false;
    const ms = parseEndMs(other.end);
    return ms != null && Math.abs(ms - targetMs) <= windowMs;
  });

  if (!candidates.length) {
    if (row.fy == null) return undefined;
    const priorFy = row.fy - 1;
    return rows.find(
      (other) => other.fp === row.fp && other.fy != null && other.fy === priorFy
    );
  }

  return candidates.sort((a, b) => {
    const ams = parseEndMs(a.end)!;
    const bms = parseEndMs(b.end)!;
    return Math.abs(ams - targetMs) - Math.abs(bms - targetMs);
  })[0];
}

function pctChange(current: number | undefined, previous: number | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }
  if (previous === 0) return null;
  // Exact ratio first; round only the final percent for storage/display.
  const pct = ((current / previous) - 1) * 100;
  return Math.round(pct * 10) / 10;
}

function daysBetweenEnds(a: string, b: string): number | null {
  const aMs = parseEndMs(a);
  const bMs = parseEndMs(b);
  if (aMs == null || bMs == null) return null;
  return Math.round((bMs - aMs) / 86_400_000);
}

/** True when revenue on this row is an annual (not quarter / YTD stub) figure. */
export function isAnnualRevenuePeriod(row: FinancialPeriodRow): boolean {
  if (row.fp != null && row.fp !== "FY") return false;
  const rev = row.metrics.revenue;
  if (rev == null || !Number.isFinite(rev)) return false;
  const bucket = row.metricDetails?.revenue?.durationBucket;
  if (bucket === "quarter" || bucket === "h1_ytd" || bucket === "nine_m_ytd") return false;
  return true;
}

/**
 * Immediately preceding fiscal-year annual row for YoY.
 * Matches by fiscal-year identity (fy − 1), requires annual revenue, and rejects
 * non-adjacent period ends (guards against mislabeled / skipped years).
 */
export function findPriorYearAnnualRow(
  rows: FinancialPeriodRow[],
  row: FinancialPeriodRow
): FinancialPeriodRow | null {
  if (row.fy == null || !row.end) return null;
  if (row.metrics.revenue == null || !Number.isFinite(row.metrics.revenue)) return null;
  if (row.fp != null && row.fp !== "FY") return null;

  const priorFy = row.fy - 1;
  const candidates = rows.filter((other) => {
    if (other === row) return false;
    if (other.fy !== priorFy) return false;
    if (other.fp != null && other.fp !== "FY") return false;
    if (!isAnnualRevenuePeriod(other)) return false;
    if (!other.end) return false;
    const days = daysBetweenEnds(other.end, row.end!);
    // Adjacent fiscal years are typically ~1 year apart (allow leap / 52–53 week FY).
    if (days == null || days < 300 || days > 450) return false;
    return true;
  });

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;

  const targetMs = (parseEndMs(row.end) ?? 0) - Math.round(365.25 * 86_400_000);
  return (
    [...candidates].sort((a, b) => {
      const da = Math.abs((parseEndMs(a.end) ?? 0) - targetMs);
      const db = Math.abs((parseEndMs(b.end) ?? 0) - targetMs);
      return da - db;
    })[0] ?? null
  );
}

export function applyYoYGrowth(
  rows: FinancialPeriodRow[],
  scope: "annual" | "quarterly"
): FinancialPeriodRow[] {
  // Group/sort by fiscal year (newest first) so YoY never walks an unsorted mix.
  const sorted = [...rows].sort((a, b) => {
    if ((a.fy ?? 0) !== (b.fy ?? 0)) return (b.fy ?? 0) - (a.fy ?? 0);
    const endCmp = String(b.end ?? "").localeCompare(String(a.end ?? ""));
    if (endCmp !== 0) return endCmp;
    const fpOrder = { FY: 0, Q4: 1, Q3: 2, Q2: 3, Q1: 4 };
    return (fpOrder[a.fp as keyof typeof fpOrder] ?? 9) - (fpOrder[b.fp as keyof typeof fpOrder] ?? 9);
  });

  for (const row of sorted) {
    const prior =
      scope === "quarterly"
        ? findPriorYearQuarterRow(sorted, row)
        : findPriorYearAnnualRow(sorted, row);
    if (!prior) {
      // Explicitly clear stale YoY rather than leaving a value from a bad prior pass.
      delete row.derived.revenue_growth_yoy;
      delete row.derived.eps_growth_yoy;
      continue;
    }

    const growth = computeDerivedForPeriod(row.metrics, {
      metricDetails: row.metricDetails,
      ytdRevenue: scope === "quarterly" ? ytdRevenueThroughRow(sorted, row) : row.metrics.revenue,
      metricSources: row.metricSources,
    });
    const revYoY = pctChange(row.metrics.revenue, prior.metrics.revenue);
    const epsYoY = pctChange(row.metrics.eps_diluted, prior.metrics.eps_diluted);
    if (revYoY != null) growth.revenue_growth_yoy = revYoY;
    if (epsYoY != null) growth.eps_growth_yoy = epsYoY;
    row.derived = { ...row.derived, ...growth };
  }

  return scope === "annual" ? sorted : rows;
}

function margin(numerator: number | undefined, denominator: number | undefined): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Unitless ratio (e.g. current ratio, debt/equity) rounded to 2 decimals. */
function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return Math.round((numerator / denominator) * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Fallback when source tags are unavailable. */
function computeTotalDebtNaive(
  metrics: Partial<Record<FinancialMetricKey, number>>
): number | null {
  const current = metrics.current_debt;
  const longTerm = metrics.long_term_debt;
  const cp = metrics.commercial_paper;
  const parts = [longTerm, current, cp].filter(
    (v): v is number => v != null && Number.isFinite(v)
  );
  if (!parts.length) return null;
  return round2(parts.reduce((a, b) => a + b, 0));
}

/**
 * EBITDA: prefer OperatingIncome + D&A; otherwise
 * NetIncome + InterestExpense + IncomeTaxExpense + D&A.
 */
function computeEbitda(
  metrics: Partial<Record<FinancialMetricKey, number>>
): number | null {
  const da = metrics.depreciation_amortization;
  if (da == null || !Number.isFinite(da)) return null;
  const operating = metrics.operating_income;
  if (operating != null && Number.isFinite(operating)) {
    return round2(operating + da);
  }
  const net = metrics.net_income;
  if (net == null || !Number.isFinite(net)) return null;
  const interest = metrics.interest_expense ?? 0;
  const tax = metrics.income_tax_expense ?? 0;
  return round2(net + interest + tax + da);
}

const QUARTER_ORDER = ["Q1", "Q2", "Q3"] as const;

/**
 * Sum standalone quarterly revenue from FY start through `row.fp` (same fy).
 */
export function ytdRevenueThroughRow(
  rows: FinancialPeriodRow[],
  row: FinancialPeriodRow
): number | null {
  if (row.fy == null || !row.fp || row.fp === "FY") return null;
  const idx = QUARTER_ORDER.indexOf(row.fp as (typeof QUARTER_ORDER)[number]);
  if (idx < 0) return null;
  const needed = QUARTER_ORDER.slice(0, idx + 1);
  let sum = 0;
  for (const fp of needed) {
    const matches = rows.filter(
      (other) =>
        other.fy === row.fy &&
        other.fp === fp &&
        other.metrics.revenue != null &&
        Number.isFinite(other.metrics.revenue)
    );
    if (!matches.length) return null;
    const pick = [...matches].sort((a, b) => String(b.end).localeCompare(String(a.end)))[0]!;
    sum += pick.metrics.revenue!;
  }
  return round2(sum);
}

function cashFlowUsesYtdBasis(
  details: Partial<Record<FinancialMetricKey, MetricValueDetail>> | undefined
): boolean {
  const ocf = details?.operating_cash_flow;
  if (!ocf) return false;
  return isYtdDurationBucket(ocf.durationBucket) && ocf.normalizedQuarterValue == null;
}

/**
 * When long-term debt mapped to aggregate LongTermDebt and current term debt exists,
 * replace displayed long-term with implied noncurrent (aggregate − current).
 */
export function refineLongTermDebtMetric(row: FinancialPeriodRow): void {
  const ltSource = row.metricSources.long_term_debt;
  const curSource = row.metricSources.current_debt;
  const lt = row.metrics.long_term_debt;
  const cur = row.metrics.current_debt;
  if (lt == null || cur == null || !ltSource?.gaapTag || !curSource?.gaapTag) return;
  if (classifyDebtTag(ltSource.gaapTag) !== "aggregate_term") return;
  if (classifyDebtTag(curSource.gaapTag) !== "current_term") return;
  const impliedNoncurrent = round2(lt - cur);
  if (!(impliedNoncurrent > 0)) return;

  row.metrics.long_term_debt = impliedNoncurrent;
  const detail = row.metricDetails.long_term_debt;
  if (detail) {
    row.metricDetails.long_term_debt = {
      ...detail,
      reportedValue: impliedNoncurrent,
      normalizedQuarterValue: impliedNoncurrent,
    };
  }
  // Reclassify as noncurrent for total-debt aggregation; keep filing provenance.
  row.metricSources.long_term_debt = {
    ...ltSource,
    gaapTag: "LongTermDebtNoncurrent",
  };
  const flag = `long_term_debt implied noncurrent from ${ltSource.gaapTag} (${lt}) − ${curSource.gaapTag} (${cur})`;
  row.validationFlags = [...(row.validationFlags ?? []), flag];
}

export function resolvePeriodTotalDebt(row: FinancialPeriodRow): TotalDebtResolution | null {
  return resolveTotalDebt({
    longTermDebt: row.metrics.long_term_debt,
    currentDebt: row.metrics.current_debt,
    commercialPaper: row.metrics.commercial_paper,
    longTermSource: row.metricSources.long_term_debt,
    currentSource: row.metricSources.current_debt,
    commercialPaperSource: row.metricSources.commercial_paper,
  });
}

/**
 * When period-end shares outstanding were not tagged (common on 10-Qs that only
 * publish cover-page DEI shares on a later date), reuse the most recent earlier
 * period that did publish them — typically the prior 10-K.
 * Prefer exact period-end shares when present; never overwrite them.
 */
export function applyCarriedSharesOutstanding(
  row: FinancialPeriodRow,
  pool: FinancialPeriodRow[]
): boolean {
  const existing = row.metrics.shares_outstanding;
  if (existing != null && Number.isFinite(existing) && existing > 0) return false;
  if (!row.end) return false;

  const prior = [...pool]
    .filter((other) => {
      if (other === row) return false;
      const so = other.metrics.shares_outstanding;
      if (so == null || !Number.isFinite(so) || !(so > 0)) return false;
      if (!other.end) return false;
      return other.end < row.end;
    })
    .sort((a, b) => String(b.end).localeCompare(String(a.end)))[0];

  if (!prior?.metrics.shares_outstanding) return false;

  row.metrics.shares_outstanding = prior.metrics.shares_outstanding;
  const priorDetail = prior.metricDetails.shares_outstanding;
  if (priorDetail) {
    row.metricDetails.shares_outstanding = { ...priorDetail };
  }
  const priorSource = prior.metricSources.shares_outstanding;
  if (priorSource) {
    row.metricSources.shares_outstanding = { ...priorSource };
  }
  const label = `${prior.fp ?? "period"} ${prior.end}${prior.form ? ` (${prior.form})` : ""}`;
  row.validationFlags = [
    ...(row.validationFlags ?? []),
    `shares_outstanding carried from ${label}`,
  ];
  return true;
}

export function computeDerivedForPeriod(
  metrics: Partial<Record<FinancialMetricKey, number>>,
  options: {
    metricDetails?: Partial<Record<FinancialMetricKey, MetricValueDetail>>;
    ytdRevenue?: number | null;
    metricSources?: FinancialPeriodRow["metricSources"];
  } = {}
): Partial<Record<DerivedMetricKey, number>> {
  const derived: Partial<Record<DerivedMetricKey, number>> = {};
  const ocf = metrics.operating_cash_flow;
  const capex = metrics.capital_expenditures;
  if (ocf != null && capex != null) {
    derived.free_cash_flow = Math.round((ocf - Math.abs(capex)) * 100) / 100;
  }
  derived.gross_margin = margin(metrics.gross_profit, metrics.revenue) ?? undefined;
  derived.operating_margin = margin(metrics.operating_income, metrics.revenue) ?? undefined;
  derived.net_margin = margin(metrics.net_income, metrics.revenue) ?? undefined;

  const debtResolution = resolveTotalDebt({
    longTermDebt: metrics.long_term_debt,
    currentDebt: metrics.current_debt,
    commercialPaper: metrics.commercial_paper,
    longTermSource: options.metricSources?.long_term_debt,
    currentSource: options.metricSources?.current_debt,
    commercialPaperSource: options.metricSources?.commercial_paper,
  });
  const totalDebt = debtResolution?.totalDebt ?? computeTotalDebtNaive(metrics);
  if (totalDebt != null) derived.total_debt = totalDebt;

  const ebitda = computeEbitda(metrics);
  if (ebitda != null) derived.ebitda = ebitda;

  // ROE / ROA / asset turnover are set later via resolveReturnMetricsForRow (TTM / FY / labeled quarter).

  // Debt and equity are same-period balance-sheet values on this row.
  derived.current_ratio = ratio(metrics.current_assets, metrics.current_liabilities) ?? undefined;
  if (totalDebt != null) {
    derived.debt_to_equity = ratio(totalDebt, metrics.shareholder_equity) ?? undefined;
  }
  derived.book_value_per_share =
    ratio(metrics.shareholder_equity, metrics.shares_outstanding) ?? undefined;

  if (derived.free_cash_flow != null) {
    const revenueForFcf = cashFlowUsesYtdBasis(options.metricDetails)
      ? options.ytdRevenue ?? null
      : metrics.revenue;
    derived.free_cash_flow_margin =
      margin(derived.free_cash_flow, revenueForFcf ?? undefined) ?? undefined;
  }

  return derived;
}

export function enrichPeriodRows(
  rows: FinancialPeriodRow[],
  scope: "annual" | "quarterly",
  context: { annual?: FinancialPeriodRow[]; quarterly?: FinancialPeriodRow[] } = {}
): FinancialPeriodRow[] {
  const annualRows = context.annual ?? (scope === "annual" ? rows : []);
  const quarterlyRows = context.quarterly ?? (scope === "quarterly" ? rows : []);
  // Cross-scope pool so quarterly rows can inherit the latest 10-K share count.
  const sharesPool = [...annualRows, ...quarterlyRows];

  for (const row of rows) {
    refineLongTermDebtMetric(row);
    applyCarriedSharesOutstanding(row, sharesPool);
    const debtResolution = resolvePeriodTotalDebt(row);
    if (debtResolution) {
      row.totalDebtProvenance = debtResolution;
    }
    row.derived = {
      ...row.derived,
      ...computeDerivedForPeriod(row.metrics, {
        metricDetails: row.metricDetails,
        ytdRevenue: scope === "quarterly" ? ytdRevenueThroughRow(rows, row) : row.metrics.revenue,
        metricSources: row.metricSources,
      }),
    };
  }

  const withGrowth = applyYoYGrowth(rows, scope);

  for (const row of withGrowth) {
    const returns = resolveReturnMetricsForRow(row, quarterlyRows, annualRows, scope);
    row.returnMetricsProvenance = returns;
    if (returns.roe) row.derived.roe = returns.roe.value;
    else delete row.derived.roe;
    if (returns.roa) row.derived.roa = returns.roa.value;
    else delete row.derived.roa;
    if (returns.asset_turnover) row.derived.asset_turnover = returns.asset_turnover.value;
    else delete row.derived.asset_turnover;
  }

  return withGrowth;
}

export function pickDerivedLatest(
  annual: FinancialPeriodRow[],
  quarterly: FinancialPeriodRow[]
): {
  values: Partial<Record<DerivedMetricKey, number>>;
  periodLabels: Partial<Record<"roe" | "roa" | "asset_turnover", string>>;
} {
  const latestQuarter = quarterly[0];
  const latestAnnual = annual[0];
  const baseRow = latestQuarter ?? latestAnnual;
  const values = { ...(baseRow?.derived ?? {}) };
  const periodLabels: Partial<Record<"roe" | "roa" | "asset_turnover", string>> = {};
  const prov = baseRow?.returnMetricsProvenance;
  if (prov?.roe?.periodLabel) periodLabels.roe = prov.roe.periodLabel;
  if (prov?.roa?.periodLabel) periodLabels.roa = prov.roa.periodLabel;
  if (prov?.asset_turnover?.periodLabel) periodLabels.asset_turnover = prov.asset_turnover.periodLabel;
  return { values, periodLabels };
}

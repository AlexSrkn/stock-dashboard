import type {
  DerivedMetricKey,
  FinancialMetricKey,
  FinancialPeriodRow,
} from "./types.js";
import { parseIsoDate } from "./periodUtils.js";

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
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
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

/** Total Debt = current debt + long-term debt (sum of whichever are present). */
function computeTotalDebt(
  metrics: Partial<Record<FinancialMetricKey, number>>
): number | null {
  const current = metrics.current_debt;
  const longTerm = metrics.long_term_debt;
  const hasCurrent = current != null && Number.isFinite(current);
  const hasLongTerm = longTerm != null && Number.isFinite(longTerm);
  if (!hasCurrent && !hasLongTerm) return null;
  return round2((hasCurrent ? current! : 0) + (hasLongTerm ? longTerm! : 0));
}

/**
 * EBITDA: prefer OperatingIncome + D&A; otherwise
 * NetIncome + InterestExpense + IncomeTaxExpense + D&A.
 * Returns null when depreciation/amortization cannot be found.
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

export function computeDerivedForPeriod(
  metrics: Partial<Record<FinancialMetricKey, number>>
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

  // --- Additional derived metrics ---
  const totalDebt = computeTotalDebt(metrics);
  if (totalDebt != null) derived.total_debt = totalDebt;

  const ebitda = computeEbitda(metrics);
  if (ebitda != null) derived.ebitda = ebitda;

  // Profitability (expressed as percentages).
  derived.roe = margin(metrics.net_income, metrics.shareholder_equity) ?? undefined;
  derived.roa = margin(metrics.net_income, metrics.total_assets) ?? undefined;

  // Liquidity / leverage / efficiency (unitless ratios).
  derived.current_ratio = ratio(metrics.current_assets, metrics.current_liabilities) ?? undefined;
  if (totalDebt != null) {
    derived.debt_to_equity = ratio(totalDebt, metrics.shareholder_equity) ?? undefined;
  }
  derived.asset_turnover = ratio(metrics.revenue, metrics.total_assets) ?? undefined;

  // Per-share book value (USD/share).
  derived.book_value_per_share =
    ratio(metrics.shareholder_equity, metrics.shares_outstanding) ?? undefined;

  // Free cash flow margin (percentage of revenue).
  if (derived.free_cash_flow != null) {
    derived.free_cash_flow_margin = margin(derived.free_cash_flow, metrics.revenue) ?? undefined;
  }

  return derived;
}

export function applyYoYGrowth(
  rows: FinancialPeriodRow[],
  scope: "annual" | "quarterly"
): FinancialPeriodRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.fy !== b.fy) return (b.fy ?? 0) - (a.fy ?? 0);
    const fpOrder = { FY: 0, Q4: 1, Q3: 2, Q2: 3, Q1: 4 };
    return (fpOrder[a.fp as keyof typeof fpOrder] ?? 9) - (fpOrder[b.fp as keyof typeof fpOrder] ?? 9);
  });

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const prior =
      scope === "quarterly"
        ? findPriorYearQuarterRow(rows, row)
        : sorted.find(
            (other, j) =>
              j > i &&
              other.fp === row.fp &&
              other.fy != null &&
              row.fy != null &&
              other.fy === (row.fy as number) - 1
          );
    if (!prior) continue;
    const growth = computeDerivedForPeriod(row.metrics);
    const revYoY = pctChange(row.metrics.revenue, prior.metrics.revenue);
    const epsYoY = pctChange(row.metrics.eps_diluted, prior.metrics.eps_diluted);
    if (revYoY != null) growth.revenue_growth_yoy = revYoY;
    if (epsYoY != null) growth.eps_growth_yoy = epsYoY;
    row.derived = { ...row.derived, ...growth };
  }

  return scope === "annual" ? sorted : rows;
}

export function enrichPeriodRows(rows: FinancialPeriodRow[], scope: "annual" | "quarterly"): FinancialPeriodRow[] {
  for (const row of rows) {
    row.derived = { ...row.derived, ...computeDerivedForPeriod(row.metrics) };
  }
  return applyYoYGrowth(rows, scope);
}

export function pickDerivedLatest(
  annual: FinancialPeriodRow[],
  quarterly: FinancialPeriodRow[]
): Partial<Record<DerivedMetricKey, number>> {
  const latestQuarter = quarterly[0];
  const latestAnnual = annual[0];
  const base = latestQuarter?.derived ?? latestAnnual?.derived ?? {};
  return { ...base };
}

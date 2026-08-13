import type {
  FinancialMetricKey,
  FinancialPeriodRow,
  MetricSourceRef,
} from "./types.js";

export type ReturnPeriodBasis = "ttm" | "fy" | "quarter";

export interface BalanceSheetPointProvenance {
  end: string;
  value: number;
  fp: string | null;
  fy: number | null;
  source?: MetricSourceRef | null;
}

export interface IncomeQuarterProvenance {
  end: string;
  fp: string | null;
  fy: number | null;
  netIncome: number;
  revenue?: number | null;
  source?: MetricSourceRef | null;
}

export interface ReturnMetricProvenance {
  basis: ReturnPeriodBasis;
  /** Display fragment, e.g. "TTM", "FY", "Q3". */
  periodLabel: string;
  value: number;
  numerator: number;
  denominator: number;
  incomeQuarters?: IncomeQuarterProvenance[];
  beginningBalance?: BalanceSheetPointProvenance | null;
  endingBalance?: BalanceSheetPointProvenance | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function marginPct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 100) / 100;
}

function hasFinite(metrics: FinancialPeriodRow["metrics"], key: FinancialMetricKey): boolean {
  const v = metrics[key];
  return v != null && Number.isFinite(v);
}

/** Quarterly rows only, oldest → newest by period end. */
export function chronologicalQuarterRows(rows: FinancialPeriodRow[]): FinancialPeriodRow[] {
  return rows
    .filter((r) => r.fp && r.fp !== "FY" && r.end)
    .sort((a, b) => {
      const endCmp = String(a.end).localeCompare(String(b.end));
      if (endCmp !== 0) return endCmp;
      return (a.fy ?? 0) - (b.fy ?? 0);
    });
}

/**
 * Many issuers file only Q1–Q3 as 10-Q; Q4 is implied by the 10-K.
 * Synthesize Q4 NI = FY NI − (Q1+Q2+Q3) with FY balance-sheet amounts.
 */
export function synthesizeQ4FromAnnual(
  quarterly: FinancialPeriodRow[],
  annual: FinancialPeriodRow[]
): FinancialPeriodRow[] {
  const out: FinancialPeriodRow[] = [];
  for (const fyRow of annual) {
    if (fyRow.fp !== "FY" || fyRow.fy == null || !hasFinite(fyRow.metrics, "net_income")) continue;
    const fy = fyRow.fy;
    const q1 = quarterly.find((r) => r.fy === fy && r.fp === "Q1" && hasFinite(r.metrics, "net_income"));
    const q2 = quarterly.find((r) => r.fy === fy && r.fp === "Q2" && hasFinite(r.metrics, "net_income"));
    const q3 = quarterly.find((r) => r.fy === fy && r.fp === "Q3" && hasFinite(r.metrics, "net_income"));
    if (!q1 || !q2 || !q3 || !fyRow.end) continue;
    // Avoid duplicating an already-present Q4 row for this FY end.
    if (quarterly.some((r) => r.fy === fy && r.fp === "Q4")) continue;

    const q4Ni = round2(
      (fyRow.metrics.net_income as number) -
        (q1.metrics.net_income as number) -
        (q2.metrics.net_income as number) -
        (q3.metrics.net_income as number)
    );
    const q4Rev =
      hasFinite(fyRow.metrics, "revenue") &&
      hasFinite(q1.metrics, "revenue") &&
      hasFinite(q2.metrics, "revenue") &&
      hasFinite(q3.metrics, "revenue")
        ? round2(
            (fyRow.metrics.revenue as number) -
              (q1.metrics.revenue as number) -
              (q2.metrics.revenue as number) -
              (q3.metrics.revenue as number)
          )
        : null;

    out.push({
      end: fyRow.end,
      filed: fyRow.filed,
      form: fyRow.form ?? "10-K",
      fp: "Q4",
      fy,
      accessionNumber: fyRow.accessionNumber,
      metrics: {
        net_income: q4Ni,
        revenue: q4Rev ?? undefined,
        shareholder_equity: fyRow.metrics.shareholder_equity,
        total_assets: fyRow.metrics.total_assets,
      },
      metricDetails: {},
      metricSources: {
        net_income: fyRow.metricSources.net_income
          ? { ...fyRow.metricSources.net_income, gaapTag: `${fyRow.metricSources.net_income.gaapTag} (Q4=FY−Q1−Q2−Q3)` }
          : {
              gaapTag: "NetIncomeLoss (Q4=FY−Q1−Q2−Q3)",
              namespace: "us-gaap",
              accn: fyRow.accessionNumber,
              filed: fyRow.filed,
              form: fyRow.form,
            },
        shareholder_equity: fyRow.metricSources.shareholder_equity,
        total_assets: fyRow.metricSources.total_assets,
        revenue: fyRow.metricSources.revenue,
      },
      derived: {},
      inclusionReason: "synthesized Q4 from annual FY minus Q1–Q3",
    });
  }
  return out;
}

export function buildQuarterSeriesForReturns(
  quarterly: FinancialPeriodRow[],
  annual: FinancialPeriodRow[]
): FinancialPeriodRow[] {
  return chronologicalQuarterRows([...quarterly, ...synthesizeQ4FromAnnual(quarterly, annual)]);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Adjacent fiscal quarters are typically ~90 days apart. */
export function areContiguousQuarterEnds(ends: string[]): boolean {
  for (let i = 1; i < ends.length; i++) {
    const days = daysBetween(ends[i - 1]!, ends[i]!);
    if (days < 60 || days > 120) return false;
  }
  return true;
}

function findRowIndex(ordered: FinancialPeriodRow[], row: FinancialPeriodRow): number {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const r = ordered[i]!;
    if (r.end === row.end && r.fp === row.fp && (r.fy == null || row.fy == null || r.fy === row.fy)) {
      return i;
    }
  }
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i]!.end === row.end) return i;
  }
  return -1;
}

function balancePoint(
  row: FinancialPeriodRow,
  key: "shareholder_equity" | "total_assets"
): BalanceSheetPointProvenance | null {
  const value = row.metrics[key];
  if (value == null || !Number.isFinite(value) || !row.end) return null;
  return {
    end: row.end,
    value,
    fp: row.fp,
    fy: row.fy,
    source: row.metricSources[key] ?? null,
  };
}

/**
 * Select the latest four quarters ending at `current` that have net income.
 * Uses actual fiscal period ends (works across non-calendar fiscal years).
 * Requires approximately contiguous quarter-ends (~60–120 days apart).
 */
export function selectTtmIncomeQuarters(
  orderedQuarters: FinancialPeriodRow[],
  current: FinancialPeriodRow
): FinancialPeriodRow[] | null {
  const withNi = orderedQuarters.filter((r) => hasFinite(r.metrics, "net_income"));
  const idx = findRowIndex(withNi, current);
  if (idx < 3) return null;
  const slice = withNi.slice(idx - 3, idx + 1);
  if (slice.length !== 4) return null;
  const ends = slice.map((r) => r.end);
  if (!areContiguousQuarterEnds(ends)) return null;
  return slice;
}

function beginningBalanceBefore(
  orderedQuarters: FinancialPeriodRow[],
  firstTtmQuarter: FinancialPeriodRow,
  key: "shareholder_equity" | "total_assets"
): BalanceSheetPointProvenance | null {
  const prior = [...orderedQuarters]
    .filter((r) => r.end < firstTtmQuarter.end && hasFinite(r.metrics, key))
    .sort((a, b) => String(a.end).localeCompare(String(b.end)));
  const row = prior[prior.length - 1];
  return row ? balancePoint(row, key) : null;
}

function incomeProvenance(row: FinancialPeriodRow): IncomeQuarterProvenance | null {
  const ni = row.metrics.net_income;
  if (ni == null || !Number.isFinite(ni) || !row.end) return null;
  return {
    end: row.end,
    fp: row.fp,
    fy: row.fy,
    netIncome: ni,
    revenue: row.metrics.revenue ?? null,
    source: row.metricSources.net_income ?? null,
  };
}

function average(a: number, b: number): number {
  return (a + b) / 2;
}

export function computeTtmRoe(
  orderedQuarters: FinancialPeriodRow[],
  current: FinancialPeriodRow
): ReturnMetricProvenance | null {
  const ttmQuarters = selectTtmIncomeQuarters(orderedQuarters, current);
  if (!ttmQuarters) return null;
  const ending = balancePoint(current, "shareholder_equity");
  if (!ending) return null;
  const beginning = beginningBalanceBefore(orderedQuarters, ttmQuarters[0]!, "shareholder_equity");
  if (!beginning) return null;

  const incomeQuarters = ttmQuarters.map(incomeProvenance).filter(Boolean) as IncomeQuarterProvenance[];
  if (incomeQuarters.length !== 4) return null;
  const ttmNi = round2(incomeQuarters.reduce((s, q) => s + q.netIncome, 0));
  const denom = average(beginning.value, ending.value);
  const value = marginPct(ttmNi, denom);
  if (value == null) return null;
  return {
    basis: "ttm",
    periodLabel: "TTM",
    value,
    numerator: ttmNi,
    denominator: round2(denom),
    incomeQuarters,
    beginningBalance: beginning,
    endingBalance: ending,
  };
}

export function computeTtmRoa(
  orderedQuarters: FinancialPeriodRow[],
  current: FinancialPeriodRow
): ReturnMetricProvenance | null {
  const ttmQuarters = selectTtmIncomeQuarters(orderedQuarters, current);
  if (!ttmQuarters) return null;
  const ending = balancePoint(current, "total_assets");
  if (!ending) return null;
  const beginning = beginningBalanceBefore(orderedQuarters, ttmQuarters[0]!, "total_assets");
  if (!beginning) return null;

  const incomeQuarters = ttmQuarters.map(incomeProvenance).filter(Boolean) as IncomeQuarterProvenance[];
  if (incomeQuarters.length !== 4) return null;
  const ttmNi = round2(incomeQuarters.reduce((s, q) => s + q.netIncome, 0));
  const denom = average(beginning.value, ending.value);
  const value = marginPct(ttmNi, denom);
  if (value == null) return null;
  return {
    basis: "ttm",
    periodLabel: "TTM",
    value,
    numerator: ttmNi,
    denominator: round2(denom),
    incomeQuarters,
    beginningBalance: beginning,
    endingBalance: ending,
  };
}

export function computeTtmAssetTurnover(
  orderedQuarters: FinancialPeriodRow[],
  current: FinancialPeriodRow
): ReturnMetricProvenance | null {
  const ttmQuarters = selectTtmIncomeQuarters(orderedQuarters, current);
  if (!ttmQuarters) return null;
  // Need revenue on all four quarters
  if (!ttmQuarters.every((r) => hasFinite(r.metrics, "revenue"))) return null;
  const ending = balancePoint(current, "total_assets");
  if (!ending) return null;
  const beginning = beginningBalanceBefore(orderedQuarters, ttmQuarters[0]!, "total_assets");
  if (!beginning) return null;

  const incomeQuarters = ttmQuarters.map(incomeProvenance).filter(Boolean) as IncomeQuarterProvenance[];
  const ttmRev = round2(ttmQuarters.reduce((s, r) => s + (r.metrics.revenue ?? 0), 0));
  const denom = average(beginning.value, ending.value);
  const value = ratio(ttmRev, denom);
  if (value == null) return null;
  return {
    basis: "ttm",
    periodLabel: "TTM",
    value,
    numerator: ttmRev,
    denominator: round2(denom),
    incomeQuarters,
    beginningBalance: beginning,
    endingBalance: ending,
  };
}

export function computeAnnualRoe(
  row: FinancialPeriodRow,
  annualRows: FinancialPeriodRow[]
): ReturnMetricProvenance | null {
  const ni = row.metrics.net_income;
  const ending = balancePoint(row, "shareholder_equity");
  if (ni == null || !Number.isFinite(ni) || !ending) return null;
  const prior =
    row.fy != null
      ? annualRows.find(
          (r) => r.fp === "FY" && r.fy === row.fy! - 1 && hasFinite(r.metrics, "shareholder_equity")
        )
      : null;
  const beginning = prior ? balancePoint(prior, "shareholder_equity") : null;
  const denom = beginning ? average(beginning.value, ending.value) : ending.value;
  const value = marginPct(ni, denom);
  if (value == null) return null;
  return {
    basis: "fy",
    periodLabel: "FY",
    value,
    numerator: ni,
    denominator: round2(denom),
    beginningBalance: beginning,
    endingBalance: ending,
  };
}

export function computeAnnualRoa(
  row: FinancialPeriodRow,
  annualRows: FinancialPeriodRow[]
): ReturnMetricProvenance | null {
  const ni = row.metrics.net_income;
  const ending = balancePoint(row, "total_assets");
  if (ni == null || !Number.isFinite(ni) || !ending) return null;
  const prior =
    row.fy != null
      ? annualRows.find(
          (r) => r.fp === "FY" && r.fy === row.fy! - 1 && hasFinite(r.metrics, "total_assets")
        )
      : null;
  const beginning = prior ? balancePoint(prior, "total_assets") : null;
  const denom = beginning ? average(beginning.value, ending.value) : ending.value;
  const value = marginPct(ni, denom);
  if (value == null) return null;
  return {
    basis: "fy",
    periodLabel: "FY",
    value,
    numerator: ni,
    denominator: round2(denom),
    beginningBalance: beginning,
    endingBalance: ending,
  };
}

export function computeAnnualAssetTurnover(
  row: FinancialPeriodRow,
  annualRows: FinancialPeriodRow[]
): ReturnMetricProvenance | null {
  const rev = row.metrics.revenue;
  const ending = balancePoint(row, "total_assets");
  if (rev == null || !Number.isFinite(rev) || !ending) return null;
  const prior =
    row.fy != null
      ? annualRows.find(
          (r) => r.fp === "FY" && r.fy === row.fy! - 1 && hasFinite(r.metrics, "total_assets")
        )
      : null;
  const beginning = prior ? balancePoint(prior, "total_assets") : null;
  const denom = beginning ? average(beginning.value, ending.value) : ending.value;
  const value = ratio(rev, denom);
  if (value == null) return null;
  return {
    basis: "fy",
    periodLabel: "FY",
    value,
    numerator: rev,
    denominator: round2(denom),
    beginningBalance: beginning,
    endingBalance: ending,
  };
}

/** Explicit single-quarter fallback — never unlabeled. */
export function computeQuarterRoe(row: FinancialPeriodRow): ReturnMetricProvenance | null {
  const ni = row.metrics.net_income;
  const eq = row.metrics.shareholder_equity;
  if (ni == null || eq == null || !Number.isFinite(ni) || !Number.isFinite(eq)) return null;
  const value = marginPct(ni, eq);
  if (value == null) return null;
  return {
    basis: "quarter",
    periodLabel: row.fp && row.fp !== "FY" ? row.fp : "Quarter",
    value,
    numerator: ni,
    denominator: eq,
    endingBalance: balancePoint(row, "shareholder_equity"),
  };
}

export function computeQuarterRoa(row: FinancialPeriodRow): ReturnMetricProvenance | null {
  const ni = row.metrics.net_income;
  const assets = row.metrics.total_assets;
  if (ni == null || assets == null || !Number.isFinite(ni) || !Number.isFinite(assets)) return null;
  const value = marginPct(ni, assets);
  if (value == null) return null;
  return {
    basis: "quarter",
    periodLabel: row.fp && row.fp !== "FY" ? row.fp : "Quarter",
    value,
    numerator: ni,
    denominator: assets,
    endingBalance: balancePoint(row, "total_assets"),
  };
}

export function computeQuarterAssetTurnover(row: FinancialPeriodRow): ReturnMetricProvenance | null {
  const rev = row.metrics.revenue;
  const assets = row.metrics.total_assets;
  if (rev == null || assets == null || !Number.isFinite(rev) || !Number.isFinite(assets)) return null;
  const value = ratio(rev, assets);
  if (value == null) return null;
  return {
    basis: "quarter",
    periodLabel: row.fp && row.fp !== "FY" ? row.fp : "Quarter",
    value,
    numerator: rev,
    denominator: assets,
    endingBalance: balancePoint(row, "total_assets"),
  };
}

export interface RowReturnMetrics {
  roe: ReturnMetricProvenance | null;
  roa: ReturnMetricProvenance | null;
  asset_turnover: ReturnMetricProvenance | null;
}

/**
 * Resolve ROE / ROA / asset turnover with explicit period basis.
 * Prefer TTM (quarterly history) → FY → labeled single quarter.
 */
export function resolveReturnMetricsForRow(
  row: FinancialPeriodRow,
  allQuarterly: FinancialPeriodRow[],
  allAnnual: FinancialPeriodRow[],
  scope: "annual" | "quarterly"
): RowReturnMetrics {
  if (scope === "annual" || row.fp === "FY") {
    return {
      roe: computeAnnualRoe(row, allAnnual),
      roa: computeAnnualRoa(row, allAnnual),
      asset_turnover: computeAnnualAssetTurnover(row, allAnnual),
    };
  }

  const ordered = buildQuarterSeriesForReturns(allQuarterly, allAnnual);

  const fyIncomeRow =
    row.fy != null
      ? allAnnual.find((a) => a.fy === row.fy && a.fp === "FY" && hasFinite(a.metrics, "net_income"))
      : null;
  const fyRevenueRow =
    row.fy != null
      ? allAnnual.find((a) => a.fy === row.fy && a.fp === "FY" && hasFinite(a.metrics, "revenue"))
      : null;

  return {
    roe:
      computeTtmRoe(ordered, row) ??
      (fyIncomeRow ? computeAnnualRoe(fyIncomeRow, allAnnual) : null) ??
      computeQuarterRoe(row),
    roa:
      computeTtmRoa(ordered, row) ??
      (fyIncomeRow ? computeAnnualRoa(fyIncomeRow, allAnnual) : null) ??
      computeQuarterRoa(row),
    asset_turnover:
      computeTtmAssetTurnover(ordered, row) ??
      (fyRevenueRow ? computeAnnualAssetTurnover(fyRevenueRow, allAnnual) : null) ??
      computeQuarterAssetTurnover(row),
  };
}

import type { FinancialMetricKey, FinancialPeriodRow } from "./types.js";
import { periodCanonicalKey, type NormalizedFiscalPeriod } from "./periodUtils.js";

export { periodCanonicalKey } from "./periodUtils.js";

/** Rows must include at least one of these to appear in period tables. */
export const PRIMARY_PERIOD_METRICS: FinancialMetricKey[] = [
  "revenue",
  "operating_income",
  "net_income",
  "eps_diluted",
  "total_assets",
];

/** Instant metrics that may anchor a row when no duration facts exist (annual 10-K balance). */
export const INSTANT_PRIMARY_METRICS = new Set<FinancialMetricKey>(["total_assets"]);

export function hasPrimaryMetric(row: FinancialPeriodRow): boolean {
  return PRIMARY_PERIOD_METRICS.some(
    (key) => row.metrics[key] != null && Number.isFinite(Number(row.metrics[key]))
  );
}

export function countPrimaryMetrics(row: FinancialPeriodRow): number {
  return PRIMARY_PERIOD_METRICS.filter((key) => row.metrics[key] != null).length;
}

function primaryMetricNames(row: FinancialPeriodRow): string[] {
  return PRIMARY_PERIOD_METRICS.filter((key) => row.metrics[key] != null);
}

function mergeMetricMaps<T extends Record<string, unknown>>(
  target: Partial<T>,
  source: Partial<T>
): Partial<T> {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    if (out[key as keyof T] == null) {
      out[key as keyof T] = value as T[keyof T];
    }
  }
  return out;
}

export function mergePeriodRows(
  a: FinancialPeriodRow,
  b: FinancialPeriodRow
): FinancialPeriodRow {
  const prefer = countPrimaryMetrics(a) >= countPrimaryMetrics(b) ? a : b;
  const other = prefer === a ? b : a;

  return {
    end: prefer.end,
    filed: prefer.filed ?? other.filed,
    form: prefer.form ?? other.form,
    fp: prefer.fp ?? other.fp,
    fy: prefer.fy ?? other.fy,
    accessionNumber: prefer.accessionNumber ?? other.accessionNumber,
    metrics: mergeMetricMaps(prefer.metrics, other.metrics) as FinancialPeriodRow["metrics"],
    metricDetails: mergeMetricMaps(
      prefer.metricDetails,
      other.metricDetails
    ) as FinancialPeriodRow["metricDetails"],
    metricSources: mergeMetricMaps(
      prefer.metricSources,
      other.metricSources
    ) as FinancialPeriodRow["metricSources"],
    derived: mergeMetricMaps(prefer.derived, other.derived) as FinancialPeriodRow["derived"],
    validationFlags: [...(prefer.validationFlags ?? []), ...(other.validationFlags ?? [])],
    inclusionReason: prefer.inclusionReason ?? other.inclusionReason,
  };
}

export function comparePeriodRows(a: FinancialPeriodRow, b: FinancialPeriodRow): number {
  const endCmp = String(b.end ?? "").localeCompare(String(a.end ?? ""));
  if (endCmp !== 0) return endCmp;
  if ((a.fy ?? 0) !== (b.fy ?? 0)) return (b.fy ?? 0) - (a.fy ?? 0);
  const fpOrder = { FY: 0, Q4: 1, Q3: 2, Q2: 3, Q1: 4 };
  return (
    (fpOrder[a.fp as keyof typeof fpOrder] ?? 9) -
    (fpOrder[b.fp as keyof typeof fpOrder] ?? 9)
  );
}

/**
 * Deduplicate by fiscal_year + fiscal_period + period_end, merge metrics,
 * and keep only rows with at least one primary metric.
 */
export function finalizePeriodRows(
  rows: FinancialPeriodRow[],
  scope: "annual" | "quarterly"
): FinancialPeriodRow[] {
  const grouped = new Map<string, FinancialPeriodRow[]>();

  for (const row of rows) {
    if (row.fy == null || !row.fp || !row.end) {
      console.log(
        `[filings-fundamentals] excluded ${scope} row: missing fy/fp/period_end (fy=${row.fy}, fp=${row.fp}, end=${row.end})`
      );
      continue;
    }
    const key = periodCanonicalKey(row.fy, row.fp as NormalizedFiscalPeriod, row.end);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const finalized: FinancialPeriodRow[] = [];

  for (const [key, group] of grouped) {
    if (group.length > 1) {
      console.log(
        `[filings-fundamentals] merging ${group.length} ${scope} records for ${key}`
      );
    }

    let merged = group[0]!;
    for (let i = 1; i < group.length; i++) {
      merged = mergePeriodRows(merged, group[i]!);
    }

    if (!hasPrimaryMetric(merged)) {
      console.log(
        `[filings-fundamentals] excluded ${scope} period ${key}: no primary metrics (revenue, operating_income, net_income, eps_diluted, total_assets)`
      );
      continue;
    }

    const present = primaryMetricNames(merged);
    merged.inclusionReason = `primary metrics: ${present.join(", ")}`;
    console.log(
      `[filings-fundamentals] included ${scope} period ${key}: ${merged.inclusionReason}`
    );
    finalized.push(merged);
  }

  return finalized.sort(comparePeriodRows);
}

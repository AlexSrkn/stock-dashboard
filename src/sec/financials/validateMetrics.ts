import type { FinancialPeriodRow } from "./types.js";

const QUARTER_FP_ORDER = ["Q1", "Q2", "Q3"] as const;

export function validateQuarterlyRevenue(
  quarterly: FinancialPeriodRow[],
  annual: FinancialPeriodRow[]
): FinancialPeriodRow[] {
  const annualRevenueByFy = new Map<number, number>();
  for (const row of annual) {
    if (row.fy != null && row.metrics.revenue != null) {
      annualRevenueByFy.set(row.fy, row.metrics.revenue);
    }
  }

  const byFy = new Map<number, FinancialPeriodRow[]>();
  for (const row of quarterly) {
    if (row.fy == null) continue;
    const list = byFy.get(row.fy) ?? [];
    list.push(row);
    byFy.set(row.fy, list);
  }

  for (const [fy, rows] of byFy) {
    const sorted = [...rows].sort(
      (a, b) =>
        QUARTER_FP_ORDER.indexOf(a.fp as (typeof QUARTER_FP_ORDER)[number]) -
        QUARTER_FP_ORDER.indexOf(b.fp as (typeof QUARTER_FP_ORDER)[number])
    );

    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const revenue = row.metrics.revenue;
      if (revenue == null) continue;

      const flags: string[] = row.validationFlags ? [...row.validationFlags] : [];
      const annualRev = annualRevenueByFy.get(fy);

      if (annualRev != null && revenue > annualRev) {
        const msg = `FY${fy} ${row.fp}: quarterly revenue ${revenue} exceeds annual revenue ${annualRev}`;
        flags.push(msg);
        console.warn(`[filings-fundamentals] suspicious revenue: ${msg}`);
      }

      if (i > 0) {
        const prior = sorted[i - 1];
        const priorRev = prior.metrics.revenue;
        if (priorRev != null && priorRev > 0 && revenue > priorRev * 1.5) {
          const msg = `FY${fy} ${row.fp}: revenue ${revenue} > 150% of prior quarter ${priorRev} (possible YTD leak)`;
          flags.push(msg);
          console.warn(`[filings-fundamentals] suspicious revenue: ${msg}`);
        }
      }

      if (flags.length) row.validationFlags = flags;
    }
  }

  return quarterly;
}

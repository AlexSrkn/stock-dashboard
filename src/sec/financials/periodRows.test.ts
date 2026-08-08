import test from "node:test";
import assert from "node:assert/strict";
import {
  finalizePeriodRows,
  hasPrimaryMetric,
  mergePeriodRows,
  periodCanonicalKey,
} from "./periodRows.js";
import type { FinancialPeriodRow } from "./types.js";

function row(
  partial: Partial<FinancialPeriodRow> & Pick<FinancialPeriodRow, "fy" | "fp" | "end">
): FinancialPeriodRow {
  return {
    filed: null,
    form: "10-Q",
    accessionNumber: null,
    metrics: {},
    metricDetails: {},
    metricSources: {},
    derived: {},
    ...partial,
  };
}

test("periodCanonicalKey dedupes by fy + fp + period_end", () => {
  assert.equal(periodCanonicalKey(2025, "Q1", "2025-12-27"), "2025|Q1|2025-12-27");
});

test("finalizePeriodRows merges duplicate periods and drops empty rows", () => {
  const input = [
    row({
      fy: 2025,
      fp: "Q1",
      end: "2025-12-27",
      metrics: { revenue: 100 },
    }),
    row({
      fy: 2025,
      fp: "Q1",
      end: "2025-12-27",
      metrics: { total_assets: 500 },
    }),
    row({
      fy: 2025,
      fp: "FY",
      end: "2025-10-17",
      metrics: { shares_outstanding: 1_000 },
    }),
    row({
      fy: 2025,
      fp: "Q2",
      end: "2025-12-27",
      metrics: {},
    }),
  ];

  const out = finalizePeriodRows(input, "quarterly");
  assert.equal(out.length, 1);
  assert.equal(out[0]?.end, "2025-12-27");
  assert.equal(out[0]?.metrics.revenue, 100);
  assert.equal(out[0]?.metrics.total_assets, 500);
  assert.ok(out[0]?.inclusionReason?.includes("revenue"));
});

test("mergePeriodRows prefers row with more primary metrics", () => {
  const sparse = row({
    fy: 2026,
    fp: "Q2",
    end: "2026-03-28",
    metrics: { total_assets: 1 },
  });
  const rich = row({
    fy: 2026,
    fp: "Q2",
    end: "2026-03-28",
    metrics: { revenue: 111, operating_income: 30, net_income: 25 },
  });
  const merged = mergePeriodRows(sparse, rich);
  assert.ok(hasPrimaryMetric(merged));
  assert.equal(merged.metrics.revenue, 111);
  assert.equal(merged.metrics.total_assets, 1);
});

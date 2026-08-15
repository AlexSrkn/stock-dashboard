import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCarriedSharesOutstanding,
  enrichPeriodRows,
} from "./derivedMetrics.js";
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

test("applyCarriedSharesOutstanding uses latest prior period when missing", () => {
  const annual = row({
    fy: 2026,
    fp: "FY",
    end: "2026-01-25",
    form: "10-K",
    metrics: { shares_outstanding: 24_304_000_000, shareholder_equity: 157_293_000_000 },
    metricSources: {
      shares_outstanding: {
        gaapTag: "CommonStockSharesOutstanding",
        namespace: "us-gaap",
        accn: "a",
        filed: "2026-02-25",
        form: "10-K",
      },
    },
  });
  const quarter = row({
    fy: 2027,
    fp: "Q1",
    end: "2026-04-26",
    form: "10-Q",
    metrics: { shareholder_equity: 195_474_000_000 },
  });

  assert.equal(applyCarriedSharesOutstanding(quarter, [annual, quarter]), true);
  assert.equal(quarter.metrics.shares_outstanding, 24_304_000_000);
  assert.equal(quarter.metricSources.shares_outstanding?.gaapTag, "CommonStockSharesOutstanding");
  assert.match(quarter.validationFlags?.[0] ?? "", /carried from FY 2026-01-25/);
});

test("applyCarriedSharesOutstanding does not overwrite exact period-end shares", () => {
  const annual = row({
    fy: 2026,
    fp: "FY",
    end: "2026-01-25",
    form: "10-K",
    metrics: { shares_outstanding: 24_000_000_000 },
  });
  const quarter = row({
    fy: 2027,
    fp: "Q1",
    end: "2026-04-26",
    metrics: { shares_outstanding: 14_608_963_000 },
  });

  assert.equal(applyCarriedSharesOutstanding(quarter, [annual, quarter]), false);
  assert.equal(quarter.metrics.shares_outstanding, 14_608_963_000);
});

test("enrichPeriodRows fills quarterly BVPS from prior 10-K shares", () => {
  const annual = [
    row({
      fy: 2026,
      fp: "FY",
      end: "2026-01-25",
      form: "10-K",
      metrics: {
        revenue: 100,
        shareholder_equity: 157_293_000_000,
        shares_outstanding: 24_304_000_000,
      },
    }),
  ];
  const quarterly = [
    row({
      fy: 2027,
      fp: "Q1",
      end: "2026-04-26",
      form: "10-Q",
      metrics: {
        revenue: 40,
        shareholder_equity: 195_474_000_000,
      },
    }),
  ];

  const enriched = enrichPeriodRows(quarterly, "quarterly", { annual, quarterly });
  assert.equal(enriched[0]!.metrics.shares_outstanding, 24_304_000_000);
  assert.equal(enriched[0]!.derived.book_value_per_share, 8.04);
});

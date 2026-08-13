import test from "node:test";
import assert from "node:assert/strict";
import {
  applyYoYGrowth,
  findPriorYearAnnualRow,
  isAnnualRevenuePeriod,
} from "./derivedMetrics.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import type { FinancialPeriodRow, SecCompanyFacts } from "./types.js";

function annualRow(
  end: string,
  fy: number,
  revenue: number,
  extras: Partial<FinancialPeriodRow> = {}
): FinancialPeriodRow {
  return {
    end,
    filed: end,
    form: "10-K",
    fp: "FY",
    fy,
    accessionNumber: `fy-${fy}`,
    metrics: { revenue },
    metricDetails: {
      revenue: {
        reportedValue: revenue,
        normalizedQuarterValue: revenue,
        durationDays: 365,
        durationBucket: "annual_ytd",
        derivedStandalone: false,
        priorReportedValue: null,
        priorEnd: null,
        priorAccn: null,
        priorFiled: null,
        priorForm: null,
        priorDurationBucket: null,
      },
    },
    metricSources: {},
    derived: {},
    ...extras,
  };
}

test("findPriorYearAnnualRow matches fy-1 with adjacent period end", () => {
  const rows = [
    annualRow("2025-09-27", 2025, 416.161e9),
    annualRow("2024-09-28", 2024, 391.035e9),
    annualRow("2023-09-30", 2023, 383.285e9),
    annualRow("2022-09-24", 2022, 394.328e9),
  ];
  const prior = findPriorYearAnnualRow(rows, rows[0]!);
  assert.equal(prior?.fy, 2024);
  assert.equal(prior?.metrics.revenue, 391.035e9);
});

test("findPriorYearAnnualRow rejects skipped-year prior (FY2025 vs FY2022)", () => {
  // Simulates the old bug: mislabeled fy makes fy-1 point at FY2022 revenue.
  const fy2025 = annualRow("2025-09-27", 2025, 416.161e9);
  const mislabeledFy2022As2024 = annualRow("2022-09-24", 2024, 394.328e9);
  const prior = findPriorYearAnnualRow([fy2025, mislabeledFy2022As2024], fy2025);
  assert.equal(prior, null);
});

test("findPriorYearAnnualRow returns null when prior fy missing", () => {
  const rows = [annualRow("2025-09-27", 2025, 416e9), annualRow("2023-09-30", 2023, 383e9)];
  assert.equal(findPriorYearAnnualRow(rows, rows[0]!), null);
});

test("findPriorYearAnnualRow ignores quarterly / YTD revenue rows", () => {
  const fy2025 = annualRow("2025-09-27", 2025, 416e9);
  const q3 = {
    ...annualRow("2024-06-29", 2024, 85e9),
    fp: "Q3",
    form: "10-Q",
    metricDetails: {
      revenue: {
        reportedValue: 85e9,
        normalizedQuarterValue: 85e9,
        durationDays: 91,
        durationBucket: "quarter" as const,
        derivedStandalone: false,
        priorReportedValue: null,
        priorEnd: null,
        priorAccn: null,
        priorFiled: null,
        priorForm: null,
        priorDurationBucket: null,
      },
    },
  };
  assert.equal(isAnnualRevenuePeriod(q3), false);
  assert.equal(findPriorYearAnnualRow([fy2025, q3], fy2025), null);
});

test("AAPL-style Sept FY revenue YoY FY2022–FY2025", () => {
  const rows = [
    annualRow("2025-09-27", 2025, 416.161e9),
    annualRow("2024-09-28", 2024, 391.035e9),
    annualRow("2023-09-30", 2023, 383.285e9),
    annualRow("2022-09-24", 2022, 394.328e9),
    annualRow("2021-09-25", 2021, 365.817e9),
  ];
  // Unsorted on purpose — YoY must not use adjacent unsorted index.
  const shuffled = [rows[2]!, rows[4]!, rows[0]!, rows[3]!, rows[1]!];
  const out = applyYoYGrowth(shuffled, "annual");
  const byFy = Object.fromEntries(out.map((r) => [r.fy, r.derived.revenue_growth_yoy]));

  assert.equal(byFy[2025], 6.4);
  assert.equal(byFy[2024], 2.0);
  assert.equal(byFy[2023], -2.8);
  assert.equal(byFy[2022], 7.8);
  assert.equal(byFy[2021], undefined);
});

test("December fiscal year company revenue YoY", () => {
  const rows = [
    annualRow("2024-12-31", 2024, 245e9),
    annualRow("2023-12-31", 2023, 220e9),
    annualRow("2022-12-31", 2022, 200e9),
  ];
  const out = applyYoYGrowth(rows, "annual");
  assert.equal(
    out.find((r) => r.fy === 2024)?.derived.revenue_growth_yoy,
    Math.round(((245 / 220) - 1) * 1000) / 10
  );
  assert.equal(
    out.find((r) => r.fy === 2023)?.derived.revenue_growth_yoy,
    Math.round(((220 / 200) - 1) * 1000) / 10
  );
});

test("January (non-calendar) fiscal year company revenue YoY", () => {
  const rows = [
    annualRow("2025-01-31", 2025, 660e9),
    annualRow("2024-02-02", 2024, 640e9),
    annualRow("2023-01-27", 2023, 600e9),
  ];
  const out = applyYoYGrowth(rows, "annual");
  assert.equal(
    out.find((r) => r.fy === 2025)?.derived.revenue_growth_yoy,
    Math.round(((660 / 640) - 1) * 1000) / 10
  );
  assert.equal(
    out.find((r) => r.fy === 2024)?.derived.revenue_growth_yoy,
    Math.round(((640 / 600) - 1) * 1000) / 10
  );
});

function annualObs(
  end: string,
  start: string,
  val: number,
  fy: number,
  filed: string,
  accn: string
) {
  return { end, start, val, fy, fp: "FY", form: "10-K", filed, accn };
}

test("extractFinancials AAPL-style annual YoY with comparative 10-K restatements", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              annualObs("2025-09-27", "2024-09-29", 416.161e9, 2025, "2025-10-31", "a25"),
              annualObs("2024-09-28", "2023-10-01", 391.035e9, 2024, "2024-11-01", "a24"),
              annualObs("2023-09-30", "2022-09-25", 383.285e9, 2023, "2023-11-03", "a23"),
              annualObs("2022-09-24", "2021-09-26", 394.328e9, 2022, "2022-10-28", "a22"),
              annualObs("2021-09-25", "2020-09-27", 365.817e9, 2021, "2021-10-29", "a21"),
              // Comparatives in FY2025 10-K with wrong fy tags
              annualObs("2024-09-28", "2023-10-01", 391.035e9, 2025, "2025-10-31", "a25"),
              annualObs("2023-09-30", "2022-09-25", 383.285e9, 2025, "2025-10-31", "a25"),
              annualObs("2022-09-24", "2021-09-26", 394.328e9, 2024, "2024-11-01", "a24"),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              { end: "2025-09-27", val: 365e9, fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31", accn: "a25" },
              { end: "2024-09-28", val: 365e9, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", accn: "a24" },
              { end: "2023-09-30", val: 352e9, fy: 2023, fp: "FY", form: "10-K", filed: "2023-11-03", accn: "a23" },
              { end: "2022-09-24", val: 350e9, fy: 2022, fp: "FY", form: "10-K", filed: "2022-10-28", accn: "a22" },
              { end: "2021-09-25", val: 350e9, fy: 2021, fp: "FY", form: "10-K", filed: "2021-10-29", accn: "a21" },
            ],
          },
        },
      },
    },
  };

  const { annual } = extractFinancialsFromCompanyFacts(fixture);
  const byFy = Object.fromEntries(
    annual.filter((r) => r.metrics.revenue != null).map((r) => [r.fy, r.derived.revenue_growth_yoy])
  );

  assert.equal(byFy[2025], 6.4);
  assert.equal(byFy[2024], 2.0);
  assert.equal(byFy[2023], -2.8);
  assert.equal(byFy[2022], 7.8);
});

test("extractFinancials December FY YoY across companies", () => {
  const fixture: SecCompanyFacts = {
    cik: "0000789019",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              annualObs("2024-12-31", "2024-01-01", 245e9, 2024, "2025-02-01", "m24"),
              annualObs("2023-12-31", "2023-01-01", 220e9, 2023, "2024-02-01", "m23"),
              annualObs("2023-12-31", "2023-01-01", 220e9, 2024, "2025-02-01", "m24"),
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              { end: "2024-12-31", val: 500e9, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01", accn: "m24" },
              { end: "2023-12-31", val: 450e9, fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-01", accn: "m23" },
            ],
          },
        },
      },
    },
  };
  const { annual } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(annual.find((r) => r.fy === 2024)?.derived.revenue_growth_yoy, 11.4);
});

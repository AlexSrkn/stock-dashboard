import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import { parse8kEarningsReleases } from "./parse8kEarnings.js";
import type { SecCompanyFacts, SecFinancialFilingRow } from "./types.js";

const fixture: SecCompanyFacts = {
  cik: "0000320193",
  entityName: "Apple Inc.",
  facts: {
    "us-gaap": {
      Revenues: {
        label: "Revenues",
        units: {
          USD: [
            {
              end: "2023-09-30",
              val: 383_285_000_000,
              accn: "0000320193-23-000106",
              fy: 2023,
              fp: "FY",
              form: "10-K",
              filed: "2023-11-03",
            },
            {
              end: "2023-06-30",
              start: "2023-04-01",
              val: 81_797_000_000,
              accn: "0000320193-23-000077",
              fy: 2023,
              fp: "Q3",
              form: "10-Q",
              filed: "2023-08-04",
            },
            {
              end: "2023-06-30",
              start: "2023-01-01",
              val: 218_745_000_000,
              accn: "0000320193-23-000077",
              fy: 2023,
              fp: "Q3",
              form: "10-Q",
              filed: "2023-08-04",
            },
          ],
        },
      },
      GrossProfit: {
        units: {
          USD: [
            {
              end: "2023-09-30",
              val: 169_148_000_000,
              fy: 2023,
              fp: "FY",
              form: "10-K",
              filed: "2023-11-03",
            },
          ],
        },
      },
      NetIncomeLoss: {
        units: {
          USD: [
            {
              end: "2023-09-30",
              val: 96_995_000_000,
              fy: 2023,
              fp: "FY",
              form: "10-K",
              filed: "2023-11-03",
            },
          ],
        },
      },
      EarningsPerShareBasic: {
        units: {
          "USD/shares": [
            {
              end: "2023-09-30",
              val: 6.16,
              fy: 2023,
              fp: "FY",
              form: "10-K",
              filed: "2023-11-03",
            },
          ],
        },
      },
      Assets: {
        units: {
          USD: [
            {
              end: "2023-09-30",
              val: 352_583_000_000,
              fy: 2023,
              fp: "FY",
              form: "10-K",
              filed: "2023-11-03",
            },
          ],
        },
      },
      NetCashProvidedByUsedInOperatingActivities: {
        units: {
          USD: [
            {
              end: "2023-09-30",
              val: 110_543_000_000,
              fy: 2023,
              fp: "FY",
              form: "10-K",
              filed: "2023-11-03",
            },
          ],
        },
      },
    },
  },
};

test("extractFinancialsFromCompanyFacts maps latest XBRL metrics from most recent quarter", () => {
  const { latest } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(latest.revenue?.value, 81_797_000_000);
  assert.equal(latest.revenue?.gaapTag, "Revenues");
  assert.equal(latest.revenue?.form, "10-Q");
  assert.equal(latest.revenue?.fp, "Q3");
});

test("annual periods are deduped and 10-K only", () => {
  const { annual } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(annual.length, 1);
  assert.equal(annual[0]?.fp, "FY");
  assert.equal(annual[0]?.form, "10-K");
  assert.equal(annual[0]?.metricSources.revenue?.gaapTag, "Revenues");
});

test("quarterly periods prefer single-quarter over YTD", () => {
  const { quarterly } = extractFinancialsFromCompanyFacts(fixture);
  assert.equal(quarterly.length, 1);
  assert.equal(quarterly[0]?.fp, "Q3");
  assert.equal(quarterly[0]?.form, "10-Q");
  assert.equal(quarterly[0]?.metrics.revenue, 81_797_000_000);
});

test("statement sections are split", () => {
  const { statements } = extractFinancialsFromCompanyFacts(fixture);
  assert.ok(statements.incomeStatement.latest.revenue);
  assert.ok(statements.balanceSheet.latest.total_assets);
  assert.ok(statements.cashFlow.latest.operating_cash_flow);
});

test("AAPL-style Q3 10-Q cash flow is labeled 9M YTD, not Q3", () => {
  const aaplQ3: SecCompanyFacts = {
    cik: "0000320193",
    entityName: "Apple Inc.",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2026-03-29",
                val: 94_036_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
              {
                end: "2026-03-28",
                start: "2025-12-28",
                val: 95_359_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
                accn: "0000320193-26-000057",
              },
              {
                end: "2025-12-27",
                start: "2025-09-28",
                val: 124_300_000_000,
                fy: 2026,
                fp: "Q1",
                form: "10-Q",
                filed: "2026-01-30",
                accn: "0000320193-26-000008",
              },
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                val: 331_495_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
            ],
          },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: 116_996_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
              {
                end: "2026-03-28",
                start: "2025-09-28",
                val: 80_000_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
                accn: "0000320193-26-000057",
              },
            ],
          },
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: 6_799_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
              {
                end: "2026-03-28",
                start: "2025-09-28",
                val: 4_500_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
                accn: "0000320193-26-000057",
              },
            ],
          },
        },
        NetCashProvidedByUsedInInvestingActivities: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: -18_811_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
              {
                end: "2026-03-28",
                start: "2025-09-28",
                val: -12_000_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
                accn: "0000320193-26-000057",
              },
            ],
          },
        },
        NetCashProvidedByUsedInFinancingActivities: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: -94_575_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
              {
                end: "2026-03-28",
                start: "2025-09-28",
                val: -60_000_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
                accn: "0000320193-26-000057",
              },
            ],
          },
        },
        PaymentsOfDividends: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: 11_778_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
              {
                end: "2026-03-28",
                start: "2025-09-28",
                val: 7_800_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
                accn: "0000320193-26-000057",
              },
            ],
          },
        },
        PaymentsForRepurchaseOfCommonStock: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: 62_094_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
                accn: "0000320193-26-000079",
              },
              {
                end: "2026-03-28",
                start: "2025-09-28",
                val: 40_000_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
                accn: "0000320193-26-000057",
              },
            ],
          },
        },
      },
    },
  };

  const { quarterly, statements } = extractFinancialsFromCompanyFacts(aaplQ3);
  const q3 = quarterly.find((r) => r.fp === "Q3" && r.end === "2026-06-27");
  assert.ok(q3, "Q3 row missing");

  // Income statement keeps standalone Q3.
  assert.equal(q3.metrics.revenue, 94_036_000_000);
  assert.equal(statements.incomeStatement.latest.revenue?.value, 94_036_000_000);
  assert.equal(statements.incomeStatement.latest.revenue?.periodLabel, "Q3");

  // Balance sheet stays on the Q3 instant date.
  assert.equal(q3.metrics.total_assets, 331_495_000_000);
  assert.equal(statements.balanceSheet.latest.total_assets?.end, "2026-06-27");

  // Cash-flow statement shows filing 9M YTD values with 9M YTD labels.
  const cf = statements.cashFlow.latest;
  assert.equal(cf.operating_cash_flow?.value, 116_996_000_000);
  assert.equal(cf.operating_cash_flow?.periodLabel, "9M YTD");
  assert.equal(cf.operating_cash_flow?.end, "2026-06-27");
  assert.equal(cf.investing_cash_flow?.value, -18_811_000_000);
  assert.equal(cf.investing_cash_flow?.periodLabel, "9M YTD");
  assert.equal(cf.financing_cash_flow?.value, -94_575_000_000);
  assert.equal(cf.financing_cash_flow?.periodLabel, "9M YTD");
  assert.equal(cf.capital_expenditures?.value, 6_799_000_000);
  assert.equal(cf.capital_expenditures?.periodLabel, "9M YTD");
  assert.equal(cf.dividends_paid?.value, 11_778_000_000);
  assert.equal(cf.dividends_paid?.periodLabel, "9M YTD");
  assert.equal(cf.share_repurchases?.value, 62_094_000_000);
  assert.equal(cf.share_repurchases?.periodLabel, "9M YTD");

  // 9M FCF from reported 9M OCF − CapEx, labeled 9M YTD.
  assert.equal(cf.free_cash_flow?.value, 110_197_000_000);
  assert.equal(cf.free_cash_flow?.periodLabel, "9M YTD");

  // Derived standalone Q3 cash flow (9M − prior 6M) is exposed separately and labeled.
  const q3cf = statements.cashFlow.latestDerivedQuarter;
  assert.ok(q3cf, "latestDerivedQuarter missing");
  assert.equal(q3cf.operating_cash_flow?.value, 36_996_000_000);
  assert.equal(q3cf.operating_cash_flow?.periodLabel, "Q3 · derived");
  assert.equal(q3cf.operating_cash_flow?.derivation?.method, "ytd_minus_prior_ytd");
  assert.equal(q3cf.operating_cash_flow?.derivation?.current.value, 116_996_000_000);
  assert.equal(q3cf.operating_cash_flow?.derivation?.prior.value, 80_000_000_000);
  assert.equal(q3cf.operating_cash_flow?.derivation?.prior.end, "2026-03-28");
  assert.equal(q3cf.investing_cash_flow?.value, -6_811_000_000);
  assert.equal(q3cf.investing_cash_flow?.periodLabel, "Q3 · derived");
  assert.equal(q3cf.financing_cash_flow?.value, -34_575_000_000);
  assert.equal(q3cf.capital_expenditures?.value, 2_299_000_000);
  assert.equal(q3cf.dividends_paid?.value, 3_978_000_000);
  assert.equal(q3cf.share_repurchases?.value, 22_094_000_000);
  assert.equal(q3cf.free_cash_flow?.value, 34_697_000_000);
  assert.equal(q3cf.free_cash_flow?.periodLabel, "Q3 · derived");

  // Standalone Q3 cash flow is derived (9M − prior 6M), not the raw 9M.
  assert.equal(q3.metricDetails.operating_cash_flow?.reportedValue, 116_996_000_000);
  assert.equal(q3.metricDetails.operating_cash_flow?.normalizedQuarterValue, 36_996_000_000);
  assert.equal(q3.metricDetails.operating_cash_flow?.durationBucket, "nine_m_ytd");
  assert.equal(q3.metricDetails.operating_cash_flow?.derivedStandalone, true);
  assert.equal(q3.metrics.operating_cash_flow, 36_996_000_000);

  // FCF margin must use YTD revenue when cash-flow metrics are still on a YTD basis
  // without a stored standalone quarter. Here OCF is derived into metrics, so margin
  // uses Q3 revenue against Q3 FCF.
  assert.equal(q3.derived.free_cash_flow, 36_996_000_000 - 2_299_000_000);
  const q3FcfMargin = q3.derived.free_cash_flow_margin;
  assert.ok(q3FcfMargin != null);
  const expectedMargin =
    Math.round(((36_996_000_000 - 2_299_000_000) / 94_036_000_000) * 1000) / 10;
  assert.equal(q3FcfMargin, expectedMargin);
});

test("9M cash flow without prior H1 stays YTD in metrics and FCF margin uses YTD revenue", () => {
  const facts: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2026-03-29",
                val: 90_000_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
              },
              {
                end: "2026-03-28",
                start: "2025-12-28",
                val: 100_000_000_000,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-02",
              },
              {
                end: "2025-12-27",
                start: "2025-09-28",
                val: 110_000_000_000,
                fy: 2026,
                fp: "Q1",
                form: "10-Q",
                filed: "2026-01-30",
              },
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                val: 300_000_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
              },
            ],
          },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: 116_996_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
              },
            ],
          },
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: {
            USD: [
              {
                end: "2026-06-27",
                start: "2025-09-28",
                val: 6_799_000_000,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-08-01",
              },
            ],
          },
        },
      },
    },
  };

  const { quarterly, statements } = extractFinancialsFromCompanyFacts(facts);
  const q3 = quarterly.find((r) => r.fp === "Q3" && r.end === "2026-06-27");
  assert.ok(q3);
  assert.equal(q3.metrics.operating_cash_flow, 116_996_000_000);
  assert.equal(q3.metricDetails.operating_cash_flow?.normalizedQuarterValue, null);
  assert.equal(statements.cashFlow.latest.operating_cash_flow?.periodLabel, "9M YTD");
  assert.equal(statements.cashFlow.latest.free_cash_flow?.value, 110_197_000_000);
  assert.equal(statements.cashFlow.latest.free_cash_flow?.periodLabel, "9M YTD");
  assert.equal(statements.cashFlow.latestDerivedQuarter, undefined);

  // 9M FCF / (Q1+Q2+Q3 revenue) — not / Q3 revenue alone.
  const ytdRev = 110_000_000_000 + 100_000_000_000 + 90_000_000_000;
  const expected =
    Math.round((110_197_000_000 / ytdRev) * 1000) / 10;
  assert.equal(q3.derived.free_cash_flow_margin, expected);
});

test("parse8kEarningsReleases extracts Item 2.02 metrics by accession", () => {
  const eightK: SecFinancialFilingRow[] = [
    {
      form: "8-K",
      filingDate: "2023-11-02",
      reportDate: "2023-09-30",
      accessionNumber: "0000320193-23-000106",
      primaryDocument: "a8-k.htm",
      description: "Results of Operations",
      items: "2.02,9.01",
      isXBRL: true,
      href: "https://www.sec.gov/example",
    },
  ];
  const facts: SecCompanyFacts = {
    cik: "0000320193",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              {
                end: "2023-09-30",
                val: 89_500_000_000,
                accn: "0000320193-23-000106",
                fy: 2023,
                fp: "Q4",
                form: "8-K",
                filed: "2023-11-02",
              },
            ],
          },
        },
      },
    },
  };
  const releases = parse8kEarningsReleases(facts, eightK);
  assert.equal(releases.length, 1);
  assert.equal(releases[0]?.metrics.revenue, 89_500_000_000);
  assert.equal(releases[0]?.metricSources.revenue?.accn, "0000320193-23-000106");
});

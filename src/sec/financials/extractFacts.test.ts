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

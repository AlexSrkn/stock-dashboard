import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import type { SecCompanyFacts } from "./types.js";

/** Minimal IFRS 20-F / 6-K fixture (Rio Tinto–style foreign filer). */
const ifrsFixture: SecCompanyFacts = {
  cik: "0000863064",
  entityName: "RIO TINTO PLC",
  facts: {
    "ifrs-full": {
      Revenue: {
        units: {
          USD: [
            {
              end: "2023-12-31",
              start: "2023-01-01",
              val: 54_000_000_000,
              accn: "0000863064-24-000010",
              fy: 2023,
              fp: "FY",
              form: "20-F",
              filed: "2024-02-22",
            },
            {
              end: "2023-06-30",
              start: "2023-01-01",
              val: 26_000_000_000,
              accn: "0000863064-23-000040",
              fy: 2023,
              fp: "Q2",
              form: "6-K",
              filed: "2023-07-26",
            },
          ],
        },
      },
      ProfitLossFromOperatingActivities: {
        units: {
          USD: [
            {
              end: "2023-12-31",
              start: "2023-01-01",
              val: 14_000_000_000,
              fy: 2023,
              fp: "FY",
              form: "20-F",
              filed: "2024-02-22",
            },
          ],
        },
      },
      ProfitLoss: {
        units: {
          USD: [
            {
              end: "2023-12-31",
              start: "2023-01-01",
              val: 10_000_000_000,
              fy: 2023,
              fp: "FY",
              form: "20-F",
              filed: "2024-02-22",
            },
          ],
        },
      },
      BasicEarningsLossPerShare: {
        units: {
          "USD/shares": [
            {
              end: "2023-12-31",
              start: "2023-01-01",
              val: 6.12,
              fy: 2023,
              fp: "FY",
              form: "20-F",
              filed: "2024-02-22",
            },
          ],
        },
      },
      Assets: {
        units: {
          USD: [
            {
              end: "2023-12-31",
              val: 100_000_000_000,
              fy: 2023,
              fp: "FY",
              form: "20-F",
              filed: "2024-02-22",
            },
          ],
        },
      },
      CashFlowsFromUsedInOperatingActivities: {
        units: {
          USD: [
            {
              end: "2023-12-31",
              start: "2023-01-01",
              val: 15_000_000_000,
              fy: 2023,
              fp: "FY",
              form: "20-F",
              filed: "2024-02-22",
            },
          ],
        },
      },
    },
  },
};

test("extractFinancialsFromCompanyFacts: IFRS 20-F / 6-K foreign filer yields periods", () => {
  const extracted = extractFinancialsFromCompanyFacts(ifrsFixture);
  assert.ok(extracted.annual.length >= 1, "expected at least one annual period");
  const fy = extracted.annual.find((r) => r.end === "2023-12-31");
  assert.ok(fy, "expected FY2023 annual row");
  assert.equal(fy!.metrics.revenue, 54_000_000_000);
  assert.equal(fy!.metrics.operating_income, 14_000_000_000);
  assert.equal(fy!.metrics.net_income, 10_000_000_000);
  assert.equal(fy!.metrics.eps_basic, 6.12);
  assert.equal(fy!.metrics.total_assets, 100_000_000_000);
  assert.equal(fy!.metrics.operating_cash_flow, 15_000_000_000);

  const h1 = extracted.quarterly.find((r) => r.fp === "Q2" && r.end === "2023-06-30");
  assert.ok(h1, "expected 6-K Q2 interim row");
  assert.equal(h1!.metrics.revenue, 26_000_000_000);
});

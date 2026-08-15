import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import type { SecCompanyFacts } from "./types.js";

function duration(
  end: string,
  start: string,
  val: number,
  fp: string,
  fy: number,
  form: string,
  filed: string,
  accn: string
) {
  return { end, start, val, fy, fp, form, filed, accn };
}

function instant(
  end: string,
  val: number,
  fp: string,
  fy: number,
  form: string,
  filed: string,
  accn: string
) {
  return { end, val, fy, fp, form, filed, accn };
}

test("cover-page DEI shares attach to current quarter not comparative on same accession", () => {
  const fixture: SecCompanyFacts = {
    cik: "0001045810",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              // Comparative prior-year Q1 in the same 10-Q accession (listed first on purpose)
              duration("2025-04-27", "2025-01-27", 26e9, "Q1", 2026, "10-Q", "2026-05-20", "q1"),
              duration("2026-04-26", "2026-01-26", 44e9, "Q1", 2027, "10-Q", "2026-05-20", "q1"),
            ],
          },
        },
        StockholdersEquity: {
          units: {
            USD: [
              instant("2025-04-27", 83e9, "Q1", 2026, "10-Q", "2026-05-20", "q1"),
              instant("2026-04-26", 195e9, "Q1", 2027, "10-Q", "2026-05-20", "q1"),
            ],
          },
        },
      },
      dei: {
        EntityCommonStockSharesOutstanding: {
          units: {
            shares: [instant("2026-05-15", 24.2e9, "Q1", 2027, "10-Q", "2026-05-20", "q1")],
          },
        },
      },
    },
  };

  const { quarterly, statements } = extractFinancialsFromCompanyFacts(fixture);
  const current = quarterly.find((r) => r.end === "2026-04-26");
  const comparative = quarterly.find((r) => r.end === "2025-04-27");
  assert.ok(current);
  assert.equal(current.metrics.shares_outstanding, 24.2e9);
  assert.equal(
    current.metricSources.shares_outstanding?.gaapTag,
    "EntityCommonStockSharesOutstanding"
  );
  // Comparative may also receive a carry later; cover-page should prefer current quarter.
  assert.equal(statements.balanceSheet.latest.shares_outstanding?.value, 24.2e9);
  assert.equal(statements.balanceSheet.latest.shares_outstanding?.end, "2026-04-26");
  void comparative;
});

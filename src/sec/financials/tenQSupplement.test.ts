import test from "node:test";
import assert from "node:assert/strict";
import type { FinancialPeriodRow, SecFinancialFilingRow } from "./types.js";
import {
  isUsTenQFiling,
  rankTenQFilingsForSupplement,
  shouldSupplementFromTenQ,
} from "./tenQSupplement.js";

function filing(partial: Partial<SecFinancialFilingRow>): SecFinancialFilingRow {
  return {
    form: "10-Q",
    filingDate: "2026-07-29",
    reportDate: "2026-06-30",
    accessionNumber: "0001193125-26-322532",
    primaryDocument: "pool-20260630.htm",
    description: "10-Q",
    items: null,
    isXBRL: true,
    href: "",
    ...partial,
  };
}

test("isUsTenQFiling accepts 10-Q only", () => {
  assert.equal(isUsTenQFiling(filing({ form: "10-Q" })), true);
  assert.equal(isUsTenQFiling(filing({ form: "10-Q/A" })), true);
  assert.equal(isUsTenQFiling(filing({ form: "6-K" })), false);
});

test("shouldSupplementFromTenQ when newer 10-Q reportDate exists", () => {
  const quarterly = [
    { end: "2026-03-31", filed: "2026-04-28", fp: "Q1" } as FinancialPeriodRow,
  ];
  assert.equal(
    shouldSupplementFromTenQ(quarterly, [
      filing({ reportDate: "2026-06-30", filingDate: "2026-07-29" }),
    ]),
    true
  );
  assert.equal(
    shouldSupplementFromTenQ(quarterly, [
      filing({ reportDate: "2026-03-31", filingDate: "2026-04-28" }),
    ]),
    false
  );
});

test("shouldSupplementFromTenQ when no companyfacts quarters yet", () => {
  assert.equal(shouldSupplementFromTenQ([], [filing({})]), true);
});

test("rankTenQFilingsForSupplement sorts by report date and drops 6-K", () => {
  const ranked = rankTenQFilingsForSupplement([
    filing({ form: "6-K", reportDate: "2026-06-30", primaryDocument: "sixk.htm" }),
    filing({
      reportDate: "2026-03-31",
      filingDate: "2026-04-28",
      primaryDocument: "q1.htm",
    }),
    filing({
      reportDate: "2026-06-30",
      filingDate: "2026-07-29",
      primaryDocument: "q2.htm",
    }),
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.primaryDocument, "q2.htm");
});

import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCompletelySoldByTicker } from "./compute.js";

test("aggregates completely-sold prior value across institutions by ticker", () => {
  const rows = aggregateCompletelySoldByTicker([
    {
      institutionId: "A",
      ticker: "V",
      companyName: "Visa",
      quarter: "2026-Q1",
      previousPositionValueUsd: 100,
      previousShares: 10,
    },
    {
      institutionId: "B",
      ticker: "V",
      companyName: "Visa",
      quarter: "2026-Q1",
      previousPositionValueUsd: 50,
      previousShares: 5,
    },
    {
      institutionId: "A",
      ticker: "MA",
      companyName: "Mastercard",
      quarter: "2026-Q1",
      previousPositionValueUsd: 80,
      previousShares: 8,
    },
  ]);
  rows.sort((a, b) => b.previousPositionValueUsd - a.previousPositionValueUsd);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ticker, "V");
  assert.equal(rows[0].previousPositionValueUsd, 150);
  assert.equal(rows[0].previousShares, 15);
  assert.equal(rows[0].institutionsExiting, 2);
  assert.equal(rows[1].ticker, "MA");
  assert.equal(rows[1].institutionsExiting, 1);
  assert.ok(!("institutionId" in rows[0]));
});

import assert from "node:assert/strict";
import test from "node:test";
import { closeOnOrBefore, type DailyBar } from "./dataLoader.js";
import { buildPortfolioSnapshots } from "./portfolioWeights.js";
import {
  computeInstitutionHelperMetrics,
  computeRolling1yReturn,
  computeYtdReturn,
} from "./metrics.js";
import { computeTickerQuarterReturns, ReturnsMatrix } from "./priceCache.js";
import { runInstitutionPerformanceEngine } from "./performanceEngine.js";
import { computePortfolioReturnsFromMatrix, buildPortfolioWeightRows } from "./portfolioEngine.js";
import { indexPortfolioSnapshots } from "./portfolioWeights.js";
import { quarterDateRange } from "./quarters.js";

test("buildPortfolioSnapshots computes weights", () => {
  const snaps = buildPortfolioSnapshots([
    { institutionId: "0001067983", quarter: "2024-Q1", ticker: "AAPL", marketValue: 600 },
    { institutionId: "0001067983", quarter: "2024-Q1", ticker: "MSFT", marketValue: 400 },
  ]);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].weights.AAPL, 0.6);
  assert.equal(snaps[0].weights.MSFT, 0.4);
});

test("computeTickerQuarterReturns from daily bars", () => {
  const bars = new Map<string, DailyBar[]>([
    [
      "AAPL",
      [
        { date: new Date("2024-01-01T00:00:00Z"), close: 100 },
        { date: new Date("2024-03-31T00:00:00Z"), close: 110 },
        { date: new Date("2024-06-30T00:00:00Z"), close: 121 },
      ],
    ],
  ]);
  const entries = computeTickerQuarterReturns(bars, ["2024-Q1", "2024-Q2"]);
  const q1 = entries.find((e) => e.quarter === "2024-Q1");
  const q2 = entries.find((e) => e.quarter === "2024-Q2");
  assert.ok(q1?.return != null);
  assert.ok(Math.abs(q1.return! - 0.1) < 0.0001);
  assert.ok(q2?.return != null);
  assert.ok(Math.abs(q2.return! - 0.1) < 0.0001);
});

test("runInstitutionPerformanceEngine QoQ return uses prior-quarter weights", () => {
  const matrix = ReturnsMatrix.fromEntries([
    { ticker: "AAPL", quarter: "2024-Q2", return: 0.1 },
  ]);

  const result = runInstitutionPerformanceEngine({
    holdings: [{ institutionId: "FIL", quarter: "2024-Q1", ticker: "AAPL", marketValue: 1000 }],
    returnsMatrix: matrix,
    quarters: ["2024-Q1", "2024-Q2"],
  });

  const q2 = result.summaries.find((s) => s.quarter === "2024-Q2");
  assert.ok(q2);
  assert.ok(q2.qoqReturn != null);
  assert.ok(Math.abs(q2.qoqReturn - 0.1) < 0.0001);
});

test("vectorized portfolio returns match matrix lookup", () => {
  const holdings = [{ institutionId: "FIL", quarter: "2024-Q1", ticker: "AAPL", marketValue: 1000 }];
  const snaps = buildPortfolioSnapshots(holdings);
  const index = indexPortfolioSnapshots(snaps);
  const rows = buildPortfolioWeightRows(index, ["FIL"], ["2024-Q1", "2024-Q2"]);
  const matrix = ReturnsMatrix.fromEntries([{ ticker: "AAPL", quarter: "2024-Q2", return: 0.1 }]);
  const returns = computePortfolioReturnsFromMatrix(rows, matrix);
  assert.equal(returns.length, 1);
  assert.ok(Math.abs(returns[0].return! - 0.1) < 0.0001);
});

test("rolling 1Y requires minimum quarters", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.05],
    ["2024-Q2", -0.02],
  ]);
  assert.equal(computeRolling1yReturn(m, "2024-Q2", { rollingMinQuarters: 3 }), null);
});

test("YTD compounds within calendar year", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", 0.05],
  ]);
  const ytd = computeYtdReturn(m, "2024-Q2");
  assert.ok(ytd != null);
  assert.ok(Math.abs(ytd - (1.1 * 1.05 - 1)) < 0.0001);
});

test("helper metrics consistency and volatility", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", -0.05],
    ["2024-Q3", 0.02],
    ["2024-Q4", 0.03],
  ]);
  const h = computeInstitutionHelperMetrics(m);
  assert.equal(h.consistencyScore, 0.75);
  assert.ok(h.volatility != null && h.volatility > 0);
  assert.equal(h.bestQuarter, 0.1);
  assert.equal(h.worstQuarter, -0.05);
});

test("closeOnOrBefore picks latest bar on or before target", () => {
  const range = quarterDateRange("2024-Q1");
  assert.ok(range);
  const bars = [
    { date: new Date(`${range.start}T00:00:00Z`), close: 100 },
    { date: new Date(`${range.end}T00:00:00Z`), close: 110 },
  ];
  assert.equal(closeOnOrBefore(bars, range.start), 100);
  assert.equal(closeOnOrBefore(bars, range.end), 110);
});

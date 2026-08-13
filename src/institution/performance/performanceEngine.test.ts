import assert from "node:assert/strict";
import test from "node:test";
import { closeOnOrBefore, type DailyBar } from "./dataLoader.js";
import { buildPortfolioSnapshots, indexPortfolioSnapshots } from "./portfolioWeights.js";
import {
  annualizedVolatility,
  computeConsistencyThrough,
  computeInstitutionHelperMetrics,
  computeRolling1yReturn,
  computeVolatilityThrough,
  computeYtdReturn,
} from "./metrics.js";
import { computeTickerQuarterReturns, ReturnsMatrix } from "./priceCache.js";
import { runInstitutionPerformanceEngine } from "./performanceEngine.js";
import {
  buildPortfolioWeightRows,
  computeInstitutionPerformanceWithDebug,
  computePortfolioReturnsFromMatrix,
} from "./portfolioEngine.js";
import { quarterDateRange, quarterReturnDateRange, returnQuartersFromHoldings } from "./quarters.js";

test("buildPortfolioSnapshots computes weights", () => {
  const snaps = buildPortfolioSnapshots([
    { institutionId: "0001067983", quarter: "2024-Q1", ticker: "AAPL", marketValue: 600 },
    { institutionId: "0001067983", quarter: "2024-Q1", ticker: "MSFT", marketValue: 400 },
  ]);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].weights.AAPL, 0.6);
  assert.equal(snaps[0].weights.MSFT, 0.4);
});

test("quarterReturnDateRange is previous quarter-end → current quarter-end", () => {
  assert.deepEqual(quarterReturnDateRange("2024-Q2"), { start: "2024-03-31", end: "2024-06-30" });
});

test("computeTickerQuarterReturns uses prior quarter-end prices", () => {
  const bars = new Map<string, DailyBar[]>([
    [
      "AAPL",
      [
        { date: new Date("2024-03-31T00:00:00Z"), close: 100 },
        { date: new Date("2024-06-30T00:00:00Z"), close: 110 },
      ],
    ],
  ]);
  const q2 = computeTickerQuarterReturns(bars, ["2024-Q2"]).find((e) => e.quarter === "2024-Q2");
  assert.ok(q2?.return != null);
  assert.ok(Math.abs(q2.return! - 0.1) < 0.0001);
});

test("QoQ uses prior-quarter holdings weights (no look-ahead from current holdings)", () => {
  const matrix = ReturnsMatrix.fromEntries([
    { ticker: "AAPL", quarter: "2024-Q2", return: 0.1 },
    { ticker: "MSFT", quarter: "2024-Q2", return: -0.05 },
    { ticker: "NVDA", quarter: "2024-Q2", return: 0.5 },
  ]);
  const result = runInstitutionPerformanceEngine({
    holdings: [
      { institutionId: "FIL", quarter: "2024-Q1", ticker: "AAPL", marketValue: 700 },
      { institutionId: "FIL", quarter: "2024-Q1", ticker: "MSFT", marketValue: 300 },
      { institutionId: "FIL", quarter: "2024-Q2", ticker: "AAPL", marketValue: 100 },
      { institutionId: "FIL", quarter: "2024-Q2", ticker: "NVDA", marketValue: 900 },
    ],
    returnsMatrix: matrix,
    quarters: ["2024-Q2"],
  });
  const q2 = result.summaries.find((s) => s.quarter === "2024-Q2");
  assert.ok(Math.abs((q2?.qoqReturn ?? NaN) - 0.055) < 0.0001);
});

test("new position excluded; fully sold position still contributes", () => {
  const matrix = ReturnsMatrix.fromEntries([
    { ticker: "AAPL", quarter: "2024-Q2", return: 0.2 },
    { ticker: "MSFT", quarter: "2024-Q2", return: -0.1 },
    { ticker: "NVDA", quarter: "2024-Q2", return: 0.5 },
  ]);
  const { summaries, debug } = computeInstitutionPerformanceWithDebug(
    [
      { institutionId: "FIL", quarter: "2024-Q1", ticker: "AAPL", marketValue: 500 },
      { institutionId: "FIL", quarter: "2024-Q1", ticker: "MSFT", marketValue: 500 },
      { institutionId: "FIL", quarter: "2024-Q2", ticker: "MSFT", marketValue: 800 },
      { institutionId: "FIL", quarter: "2024-Q2", ticker: "NVDA", marketValue: 200 },
    ],
    matrix,
    ["2024-Q2"]
  );
  assert.ok(Math.abs((summaries[0]?.qoqReturn ?? NaN) - 0.05) < 0.0001);
  assert.equal(debug[0]?.soldPositions, 1);
  assert.equal(debug[0]?.newPositionsExcluded, 1);
});

test("missing price data does not emit a fabricated 0% quarter row", () => {
  const result = runInstitutionPerformanceEngine({
    holdings: [
      { institutionId: "FIL", quarter: "2024-Q1", ticker: "AAPL", marketValue: 1000 },
      { institutionId: "FIL", quarter: "2024-Q2", ticker: "AAPL", marketValue: 1000 },
    ],
    returnsMatrix: ReturnsMatrix.fromEntries([]),
    quarters: ["2024-Q2"],
  });
  assert.equal(result.summaries.length, 0);
  assert.ok(!result.summaries.some((s) => s.qoqReturn === 0));
});

test("3 quarterly returns → Rolling 1Y is N/A", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.05],
    ["2024-Q2", -0.02],
    ["2024-Q3", 0.03],
  ]);
  assert.equal(computeRolling1yReturn(m, "2024-Q3"), null);
});

test("4 quarterly returns → Rolling 1Y is compounded 4-quarter return", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", 0.05],
    ["2024-Q3", -0.02],
    ["2024-Q4", 0.03],
  ]);
  const r = computeRolling1yReturn(m, "2024-Q4");
  assert.ok(r != null);
  assert.ok(Math.abs(r - (1.1 * 1.05 * 0.98 * 1.03 - 1)) < 0.0001);
});

test("Q2 YTD compounds Q1 and Q2", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", 0.05],
  ]);
  const ytd = computeYtdReturn(m, "2024-Q2");
  assert.ok(ytd != null);
  assert.ok(Math.abs(ytd - (1.1 * 1.05 - 1)) < 0.0001);
});

test("Q3 YTD compounds Q1, Q2 and Q3", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", 0.05],
    ["2024-Q3", -0.02],
  ]);
  const ytd = computeYtdReturn(m, "2024-Q3");
  assert.ok(ytd != null);
  assert.ok(Math.abs(ytd - (1.1 * 1.05 * 0.98 - 1)) < 0.0001);
});

test("Q4 YTD compounds all four quarters", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", 0.05],
    ["2024-Q3", -0.02],
    ["2024-Q4", 0.03],
  ]);
  const ytd = computeYtdReturn(m, "2024-Q4");
  assert.ok(ytd != null);
  assert.ok(Math.abs(ytd - (1.1 * 1.05 * 0.98 * 1.03 - 1)) < 0.0001);
});

test("YTD is N/A when an earlier calendar quarter is missing (never 0%)", () => {
  const m = new Map<string, number | null>([["2024-Q2", 0.05]]);
  assert.equal(computeYtdReturn(m, "2024-Q2"), null);
});

test("1 return → volatility N/A; 2+ returns → volatility calculated", () => {
  const one = new Map<string, number | null>([["2024-Q1", 0.1]]);
  assert.equal(computeVolatilityThrough(one, "2024-Q1"), null);
  assert.equal(annualizedVolatility([0.1]), null);

  const two = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", -0.05],
  ]);
  const vol = computeVolatilityThrough(two, "2024-Q2");
  assert.ok(vol != null && vol > 0);
  const expected = annualizedVolatility([0.1, -0.05]);
  assert.equal(vol, expected);
});

test("rolling 4-quarter volatility once four quarters exist", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", -0.05],
    ["2024-Q3", 0.02],
    ["2024-Q4", 0.03],
    ["2025-Q1", 0.01],
  ]);
  const volQ4 = computeVolatilityThrough(m, "2024-Q4");
  const volQ1 = computeVolatilityThrough(m, "2025-Q1");
  assert.equal(volQ4, annualizedVolatility([0.1, -0.05, 0.02, 0.03]));
  assert.equal(volQ1, annualizedVolatility([-0.05, 0.02, 0.03, 0.01]));
  assert.notEqual(volQ4, volQ1);
});

test("consistency changes based on actual return signs", () => {
  const m = new Map<string, number | null>([
    ["2025-Q3", 0.076],
    ["2025-Q4", 0.0591],
    ["2026-Q1", -0.0491],
  ]);
  assert.equal(computeConsistencyThrough(m, "2025-Q3"), 1);
  assert.equal(computeConsistencyThrough(m, "2025-Q4"), 1);
  assert.equal(computeConsistencyThrough(m, "2026-Q1"), round667(2 / 3));
});

function round667(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

test("per-row consistency and volatility differ across quarters in the series", () => {
  const matrix = ReturnsMatrix.fromEntries([
    { ticker: "AAPL", quarter: "2024-Q2", return: 0.076 },
    { ticker: "AAPL", quarter: "2024-Q3", return: 0.0591 },
    { ticker: "AAPL", quarter: "2024-Q4", return: -0.0491 },
  ]);
  const result = runInstitutionPerformanceEngine({
    holdings: [
      { institutionId: "FIL", quarter: "2024-Q1", ticker: "AAPL", marketValue: 1000 },
      { institutionId: "FIL", quarter: "2024-Q2", ticker: "AAPL", marketValue: 1000 },
      { institutionId: "FIL", quarter: "2024-Q3", ticker: "AAPL", marketValue: 1000 },
      { institutionId: "FIL", quarter: "2024-Q4", ticker: "AAPL", marketValue: 1000 },
    ],
    returnsMatrix: matrix,
    options: { maxHoldingsQuarters: null },
  });
  const byQ = Object.fromEntries(result.summaries.map((s) => [s.quarter, s]));
  assert.equal(byQ["2024-Q2"].consistencyScore, 1);
  assert.equal(byQ["2024-Q2"].volatility, null); // only 1 return so far
  assert.equal(byQ["2024-Q3"].consistencyScore, 1);
  assert.ok(byQ["2024-Q3"].volatility != null);
  assert.equal(byQ["2024-Q4"].consistencyScore, round667(2 / 3));
  assert.ok(byQ["2024-Q4"].volatility != null);
  assert.notEqual(byQ["2024-Q3"].volatility, byQ["2024-Q4"].volatility);
  assert.equal(byQ["2024-Q4"].rolling1yReturn, null); // only 3 returns
});

test("missing historical periods are not invented", () => {
  const holdings = [
    { institutionId: "FIL", quarter: "2024-Q4", ticker: "AAPL", marketValue: 100 },
    { institutionId: "FIL", quarter: "2025-Q1", ticker: "AAPL", marketValue: 110 },
  ];
  assert.deepEqual(returnQuartersFromHoldings(holdings), ["2025-Q1"]);
  const result = runInstitutionPerformanceEngine({
    holdings,
    returnsMatrix: ReturnsMatrix.fromEntries([{ ticker: "AAPL", quarter: "2025-Q1", return: 0.1 }]),
  });
  assert.equal(result.summaries.length, 1);
  assert.equal(result.summaries[0].quarter, "2025-Q1");
  assert.ok(!result.summaries.some((s) => s.quarter.startsWith("2014")));
});

test("helper metrics consistency and annualized volatility", () => {
  const m = new Map<string, number | null>([
    ["2024-Q1", 0.1],
    ["2024-Q2", -0.05],
    ["2024-Q3", 0.02],
    ["2024-Q4", 0.03],
  ]);
  const h = computeInstitutionHelperMetrics(m);
  assert.equal(h.consistencyScore, 0.75);
  assert.equal(h.volatility, annualizedVolatility([0.1, -0.05, 0.02, 0.03]));
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

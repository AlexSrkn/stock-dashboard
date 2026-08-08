import assert from "node:assert/strict";
import test from "node:test";
import { buildSmartMoneyScores } from "./compositeScore.js";
import { computeAlignmentScore } from "./compositeScore.js";
import { insiderRoleWeight } from "./roleWeights.js";
import { convictionScoreFromFinal, zScoreNormalizeMap } from "./normalize.js";

test("insider role weights", () => {
  assert.equal(insiderRoleWeight("Chief Executive Officer"), 1.0);
  assert.equal(insiderRoleWeight("CFO"), 0.8);
  assert.equal(insiderRoleWeight("Chairman"), 0.9);
  assert.equal(insiderRoleWeight("Director"), 0.5);
  assert.equal(insiderRoleWeight("VP Engineering"), 0.3);
});

test("alignment is 1 when all signals agree", () => {
  assert.equal(computeAlignmentScore(1, 0.5, 0.2), 1);
  assert.equal(computeAlignmentScore(-1, -0.5, -0.2), 1);
});

test("alignment is lower when mixed", () => {
  assert.ok(computeAlignmentScore(1, -0.5, 0.2) < 1);
});

test("z-score normalize centers universe", () => {
  const m = zScoreNormalizeMap(
    new Map([
      ["A", 10],
      ["B", 20],
      ["C", 30],
    ])
  );
  const vals = [...m.values()];
  assert.ok(vals.some((v) => v < 0));
  assert.ok(vals.some((v) => v > 0));
});

test("conviction score is neutral near 50 for zero final", () => {
  const score = convictionScoreFromFinal(0, [-1, 0, 1]);
  assert.ok(Math.abs(score - 50) < 1);
});

test("buildSmartMoneyScores ranks bullish tickers higher", () => {
  const scores = buildSmartMoneyScores([
    { ticker: "BULL", institutionalFlowRaw: 50_000_000, insiderFlowRaw: 2_000_000, politicianFlowRaw: 50_000 },
    { ticker: "BEAR", institutionalFlowRaw: -50_000_000, insiderFlowRaw: -2_000_000, politicianFlowRaw: -50_000 },
    { ticker: "FLAT", institutionalFlowRaw: 0, insiderFlowRaw: 0, politicianFlowRaw: 0 },
  ]);
  const bull = scores.find((s) => s.ticker === "BULL");
  const bear = scores.find((s) => s.ticker === "BEAR");
  assert.ok(bull && bear);
  assert.ok(bull.smartMoneyConvictionScore > 50);
  assert.ok(bear.smartMoneyConvictionScore < 50);
  assert.ok(bull.smartMoneyConvictionScore > bear.smartMoneyConvictionScore);
});

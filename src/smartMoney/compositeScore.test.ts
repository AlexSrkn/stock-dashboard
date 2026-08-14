import assert from "node:assert/strict";
import test from "node:test";
import { buildSmartMoneyScores } from "./compositeScore.js";
import { computeAlignmentScore } from "./compositeScore.js";
import { insiderRoleWeight } from "./roleWeights.js";
import {
  blendToConvictionScore,
  convictionScoreFromFinal,
  zScoreNormalizeMap,
} from "./normalize.js";

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

test("alignment ignores near-zero component scores", () => {
  assert.equal(computeAlignmentScore(1, 0.02, 0.02), 1 / 3);
  assert.equal(computeAlignmentScore(1, -0.02, 0.02), 1 / 3);
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

test("blendToConvictionScore is linear on [-1, 1] and does not saturate mid-range", () => {
  assert.equal(blendToConvictionScore(0), 50);
  assert.equal(blendToConvictionScore(0.5), 75);
  assert.equal(blendToConvictionScore(1), 100);
  assert.equal(blendToConvictionScore(-1), 0);
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

test("mega-cap dollar flow with noise-level alignment does not score 100", () => {
  const scores = buildSmartMoneyScores([
    { ticker: "MEGA", institutionalFlowRaw: 1e12, insiderFlowRaw: 50, politicianFlowRaw: 50 },
    { ticker: "MID", institutionalFlowRaw: 5e8, insiderFlowRaw: 5e8, politicianFlowRaw: 5e8 },
    { ticker: "SMALL", institutionalFlowRaw: 1e6, insiderFlowRaw: 1e6, politicianFlowRaw: 1e6 },
    { ticker: "FLAT", institutionalFlowRaw: 0, insiderFlowRaw: 0, politicianFlowRaw: 0 },
    { ticker: "BEAR", institutionalFlowRaw: -1e8, insiderFlowRaw: -1e8, politicianFlowRaw: -1e8 },
  ]);
  const mega = scores.find((s) => s.ticker === "MEGA");
  const mid = scores.find((s) => s.ticker === "MID");
  assert.ok(mega && mid);
  assert.ok(mega.smartMoneyConvictionScore < 100);
  assert.ok(mega.alignmentScore < 1);
  assert.ok(mid.smartMoneyConvictionScore > mega.smartMoneyConvictionScore);
});

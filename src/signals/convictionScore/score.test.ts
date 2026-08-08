import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accumulationComponentScore,
  classifyConviction,
  computeInstitutionalConvictionScore,
  highConvictionBreadthMetric,
  median,
  percentileScores,
  persistenceComponentScore,
} from "./score.js";

describe("conviction score helpers", () => {
  it("computes median correctly", () => {
    assert.equal(median([0.005, 0.01, 0.02, 0.08, 0.1]), 0.02);
    assert.equal(median([0.01, 0.02]), 0.015);
  });

  it("percentile-ranks portfolio weights", () => {
    const scores = percentileScores([0.01, 0.02, 0.05, 0.1]);
    assert.equal(scores.length, 4);
    assert.ok(scores[0]! < scores[3]!);
    assert.equal(scores[3], 100);
  });

  it("classifies score bands", () => {
    assert.equal(classifyConviction(20), "Low Conviction");
    assert.equal(classifyConviction(50), "Moderate Conviction");
    assert.equal(classifyConviction(70), "Strong Conviction");
    assert.equal(classifyConviction(80), "High Conviction");
    assert.equal(classifyConviction(95), "Exceptional Conviction");
  });

  it("weights final score 40/25/20/15", () => {
    const { score, components } = computeInstitutionalConvictionScore({
      portfolioWeightScore: 100,
      highConvictionBreadthScore: 0,
      accumulationScore: 0,
      persistenceScore: 0,
    });
    assert.equal(components.portfolioWeightScore, 100);
    assert.equal(score, 40);
  });

  it("accumulates net ratio into 0–100", () => {
    const strong = accumulationComponentScore({
      increasing: 8,
      decreasing: 1,
      newPositions: 2,
      totalActive: 10,
    });
    const weak = accumulationComponentScore({
      increasing: 1,
      decreasing: 8,
      newPositions: 0,
      totalActive: 10,
    });
    assert.ok(strong > 50);
    assert.ok(weak < 50);
  });

  it("breadth metric weights 1% and 2%", () => {
    assert.equal(highConvictionBreadthMetric(100, 0), 60);
    assert.equal(highConvictionBreadthMetric(0, 100), 40);
  });

  it("persistence rewards longer streaks", () => {
    const short = persistenceComponentScore({
      averageStreak: 1,
      holders: 10,
      streak2Plus: 2,
      streak3Plus: 0,
      streak4Plus: 0,
    });
    const long = persistenceComponentScore({
      averageStreak: 3,
      holders: 10,
      streak2Plus: 8,
      streak3Plus: 5,
      streak4Plus: 3,
    });
    assert.ok(long > short);
  });
});

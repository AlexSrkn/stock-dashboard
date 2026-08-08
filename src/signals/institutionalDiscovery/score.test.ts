import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDiscovery,
  computeDiscoveryScore,
  growthStreakAt,
  holderGrowthPercent,
  longestGrowthStreak,
  percentileScores,
} from "./score.js";

describe("institutional discovery score", () => {
  it("scores rapid holder growth higher in percentiles", () => {
    const pct = percentileScores([10, 50, 100, -20]);
    assert.ok(pct[2]! > pct[0]!);
    assert.equal(pct[2], 100);
  });

  it("weights discovery score 35/25/20/20", () => {
    const { score } = computeDiscoveryScore({
      holderGrowthScore: 100,
      newHolderScore: 0,
      growthStreakScore: 0,
      ownershipGrowthScore: 0,
    });
    assert.equal(score, 35);
  });

  it("classifies bands and insufficient data", () => {
    assert.equal(classifyDiscovery(20, false), "Early Interest");
    assert.equal(classifyDiscovery(50, false), "Emerging Discovery");
    assert.equal(classifyDiscovery(70, false), "Institutional Discovery");
    assert.equal(classifyDiscovery(80, false), "Rapid Institutional Adoption");
    assert.equal(classifyDiscovery(95, false), "Strong Institutional Discovery");
    assert.equal(classifyDiscovery(95, true), "Insufficient Data");
    assert.equal(classifyDiscovery(null, true), "Insufficient Data");
  });

  it("handles holder growth with zero previous safely", () => {
    assert.equal(holderGrowthPercent(10, 0), 100);
    assert.equal(holderGrowthPercent(0, 0), null);
    assert.equal(holderGrowthPercent(31, 18), 72.22);
  });

  it("computes ascending growth streak including baseline (18→31→52→79 = 4)", () => {
    const counts = [18, 31, 52, 79];
    assert.equal(growthStreakAt(counts, 3), 4);
    assert.equal(longestGrowthStreak(counts), 4);
  });

  it("resets streak after a decline", () => {
    const counts = [18, 31, 25, 40];
    assert.equal(growthStreakAt(counts, 2), 0);
    assert.equal(growthStreakAt(counts, 3), 2);
    assert.equal(longestGrowthStreak(counts), 2);
  });

  it("returns 0 streak for stable holders", () => {
    assert.equal(growthStreakAt([20, 20, 20], 2), 0);
  });

  it("clamps final score 0–100", () => {
    const { score } = computeDiscoveryScore({
      holderGrowthScore: 200,
      newHolderScore: 200,
      growthStreakScore: 200,
      ownershipGrowthScore: 200,
    });
    assert.equal(score, 100);
  });
});

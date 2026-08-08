import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeRepeatBuyerScore,
  currentPurchaseStreak,
  percentileScores,
  repeatBuyerClassification,
} from "./score.js";

test("current purchase streak resets on sell", () => {
  assert.equal(currentPurchaseStreak(["P", "P", "P", "S"]), 0);
  assert.equal(currentPurchaseStreak(["P", "P", "P", "P"]), 4);
  assert.equal(currentPurchaseStreak(["P", "P", "S", "P", "P", "P"]), 3);
  assert.equal(currentPurchaseStreak(["S", "P"]), 1);
  assert.equal(currentPurchaseStreak([]), 0);
});

test("repeat buyer score weights and clamp", () => {
  assert.equal(
    computeRepeatBuyerScore({
      purchaseCountScore: 100,
      streakScore: 100,
      investmentScore: 100,
      frequencyScore: 100,
    }),
    100
  );
  const mid = computeRepeatBuyerScore({
    purchaseCountScore: 50,
    streakScore: 40,
    investmentScore: 80,
    frequencyScore: 20,
  });
  assert.equal(mid, 50 * 0.4 + 40 * 0.25 + 80 * 0.2 + 20 * 0.15);
});

test("classifications", () => {
  assert.equal(repeatBuyerClassification(10), "Occasional Buyer");
  assert.equal(repeatBuyerClassification(40), "Repeat Buyer");
  assert.equal(repeatBuyerClassification(70), "Strong Accumulator");
  assert.equal(repeatBuyerClassification(85), "Serial Buyer");
});

test("percentile scores", () => {
  const scores = percentileScores([1, 2, 3, 4, 5]);
  assert.equal(scores[0], 0);
  assert.equal(scores[4], 100);
});

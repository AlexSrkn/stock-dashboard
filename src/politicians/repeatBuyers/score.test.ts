import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePoliticianRepeatBuyerScore,
  currentPurchaseStreak,
  politicianRepeatBuyerClassification,
} from "./score.js";

describe("politician repeat buyers score", () => {
  it("current streak resets on sell", () => {
    assert.equal(currentPurchaseStreak(["buy", "buy", "buy", "buy"]), 4);
    assert.equal(currentPurchaseStreak(["buy", "buy", "sell", "buy"]), 1);
    assert.equal(currentPurchaseStreak(["buy", "buy", "buy", "sell"]), 0);
  });

  it("weights and labels", () => {
    const score = computePoliticianRepeatBuyerScore({
      purchaseCountScore: 100,
      streakScore: 100,
      investmentScore: 100,
      frequencyScore: 100,
      recencyScore: 100,
    });
    assert.equal(score, 100);
    assert.equal(politicianRepeatBuyerClassification(85), "High Conviction Buyer");
    assert.equal(politicianRepeatBuyerClassification(70), "Strong Accumulator");
    assert.equal(politicianRepeatBuyerClassification(40), "Repeat Buyer");
    assert.equal(politicianRepeatBuyerClassification(39), "Occasional Buyer");
  });
});

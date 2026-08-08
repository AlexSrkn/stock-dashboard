import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeConvictionScore,
  convictionLabel,
  ownershipIncreaseToScore,
  percentileScores,
  roleScoreFromWeight,
} from "./score.js";
import { CONVICTION_ROLE_WEIGHTS, convictionRoleWeight, resolveConvictionRole } from "./roleWeights.js";

test("role weights match Conviction Buys spec", () => {
  assert.equal(convictionRoleWeight("Chief Executive Officer"), CONVICTION_ROLE_WEIGHTS.CEO);
  assert.equal(convictionRoleWeight("Founder & Director"), CONVICTION_ROLE_WEIGHTS.Founder);
  assert.equal(convictionRoleWeight("Chairman of the Board"), CONVICTION_ROLE_WEIGHTS.Chairman);
  assert.equal(convictionRoleWeight("CFO"), CONVICTION_ROLE_WEIGHTS.CFO);
  assert.equal(convictionRoleWeight("President"), CONVICTION_ROLE_WEIGHTS.President);
  assert.equal(convictionRoleWeight("Vice President"), CONVICTION_ROLE_WEIGHTS.Officer);
  assert.equal(convictionRoleWeight("Director"), CONVICTION_ROLE_WEIGHTS.Director);
  assert.equal(convictionRoleWeight("10% Owner"), CONVICTION_ROLE_WEIGHTS["10% Owner"]);
  assert.equal(resolveConvictionRole("CEO"), "CEO");
});

test("conviction score clamps and weights", () => {
  const score = computeConvictionScore({
    purchaseSizeScore: 100,
    ownershipIncreaseScore: 100,
    roleScore: 100,
    repeatBuyScore: 100,
  });
  assert.equal(score, 100);

  const mid = computeConvictionScore({
    purchaseSizeScore: 50,
    ownershipIncreaseScore: 40,
    roleScore: 80,
    repeatBuyScore: 20,
  });
  assert.ok(mid >= 0 && mid <= 100);
  assert.equal(mid, 50 * 0.4 + 40 * 0.25 + 80 * 0.2 + 20 * 0.15);
});

test("conviction labels", () => {
  assert.equal(convictionLabel(10), "Low Conviction");
  assert.equal(convictionLabel(40), "Moderate Conviction");
  assert.equal(convictionLabel(70), "High Conviction");
  assert.equal(convictionLabel(85), "Exceptional Conviction");
});

test("role score scales to CEO max", () => {
  assert.equal(roleScoreFromWeight(1.5), 100);
  assert.ok(roleScoreFromWeight(0.9) < roleScoreFromWeight(1.5));
});

test("ownership increase score rises with percent", () => {
  assert.ok(ownershipIncreaseToScore(5) < ownershipIncreaseToScore(50));
  assert.ok(ownershipIncreaseToScore(50) < ownershipIncreaseToScore(200));
});

test("percentile scores cover 0–100", () => {
  const scores = percentileScores([1, 2, 3, 4, 5]);
  assert.equal(scores[0], 0);
  assert.equal(scores[4], 100);
});

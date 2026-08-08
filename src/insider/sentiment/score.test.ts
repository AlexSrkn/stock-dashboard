import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buyerRatioToScore,
  computeSentimentScore,
  percentileToSigned,
  sentimentClassification,
} from "./score.js";

test("buyer ratio maps to signed score", () => {
  assert.equal(buyerRatioToScore(0.5), 0);
  assert.equal(buyerRatioToScore(1), 100);
  assert.equal(buyerRatioToScore(0), -100);
});

test("percentile to signed", () => {
  assert.equal(percentileToSigned(50), 0);
  assert.equal(percentileToSigned(100), 100);
  assert.equal(percentileToSigned(0), -100);
});

test("sentiment score weights and clamp", () => {
  assert.equal(
    computeSentimentScore({
      netDollarFlowScore: 100,
      buyerRatioScore: 100,
      uniqueBuyersScore: 100,
      netSharesScore: 100,
    }),
    100
  );
  assert.equal(
    computeSentimentScore({
      netDollarFlowScore: -100,
      buyerRatioScore: -100,
      uniqueBuyersScore: -100,
      netSharesScore: -100,
    }),
    -100
  );
});

test("classifications", () => {
  assert.equal(sentimentClassification(80), "Strong Bullish");
  assert.equal(sentimentClassification(50), "Bullish");
  assert.equal(sentimentClassification(0), "Neutral");
  assert.equal(sentimentClassification(-50), "Bearish");
  assert.equal(sentimentClassification(-80), "Strong Bearish");
});

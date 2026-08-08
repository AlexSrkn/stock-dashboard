import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clusterSizeToScore,
  computeHeavySellingScore,
  detectClusterSelling,
  heavySellingClassification,
} from "./score.js";
import type { RawOpenMarketSell } from "./types.js";

function sell(
  partial: Partial<RawOpenMarketSell> &
    Pick<RawOpenMarketSell, "id" | "insiderName" | "transactionDate">
): RawOpenMarketSell {
  return {
    ticker: "TEST",
    companyName: "Test",
    sector: null,
    insiderTitle: "CEO",
    filingDate: partial.transactionDate,
    shares: 1000,
    pricePerShare: 10,
    valueUsd: 10_000,
    ...partial,
  };
}

test("cluster selling requires 3 unique sellers in window", () => {
  const two = detectClusterSelling(
    [
      sell({ id: 1, insiderName: "A", transactionDate: "2024-01-01" }),
      sell({ id: 2, insiderName: "B", transactionDate: "2024-01-10" }),
    ],
    30
  );
  assert.equal(two.clusterSelling, false);
  assert.equal(two.clusterSize, 2);

  const three = detectClusterSelling(
    [
      sell({ id: 1, insiderName: "A", transactionDate: "2024-01-01" }),
      sell({ id: 2, insiderName: "B", transactionDate: "2024-01-10" }),
      sell({ id: 3, insiderName: "C", transactionDate: "2024-01-20" }),
    ],
    30
  );
  assert.equal(three.clusterSelling, true);
  assert.equal(three.clusterSize, 3);
});

test("score and labels", () => {
  assert.equal(
    computeHeavySellingScore({
      netDollarScore: 100,
      uniqueSellersScore: 100,
      executiveScore: 100,
      clusterScore: 100,
      largestSaleScore: 100,
    }),
    100
  );
  assert.equal(heavySellingClassification(90), "Extreme Insider Selling");
  assert.equal(heavySellingClassification(75), "Heavy Selling");
  assert.equal(heavySellingClassification(50), "Elevated Selling");
  assert.equal(heavySellingClassification(10), "Normal Selling");
  assert.ok(clusterSizeToScore(6, true) >= 90);
  assert.equal(clusterSizeToScore(2, false), 0);
});

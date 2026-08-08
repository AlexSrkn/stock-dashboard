import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFirstTimeBuyerTrades } from "./compute.js";
import {
  computeFirstTimeBuyerScore,
  firstTimeBuyerClassification,
  yearsSinceLastBuyScore,
} from "./score.js";
import { firstTimeBuyerRoleWeight } from "./config.js";
import type { RawOpenMarketBuy } from "./types.js";

function buy(
  partial: Partial<RawOpenMarketBuy> & Pick<RawOpenMarketBuy, "id" | "transactionDate">
): RawOpenMarketBuy {
  return {
    ticker: "TEST",
    companyName: "Test Co",
    sector: "Technology",
    insiderName: "Jane Doe",
    insiderTitle: "CEO",
    filingDate: partial.transactionDate,
    shares: 1000,
    pricePerShare: 10,
    valueUsd: 10_000,
    ...partial,
  };
}

test("role weights match spec", () => {
  assert.equal(firstTimeBuyerRoleWeight("CEO"), 1.5);
  assert.equal(firstTimeBuyerRoleWeight("Founder"), 1.45);
  assert.equal(firstTimeBuyerRoleWeight("10% Owner"), 0.9);
});

test("detects first-ever and long-gap return buys", () => {
  const trades = detectFirstTimeBuyerTrades(
    [
      buy({ id: 1, transactionDate: "2015-01-01" }),
      buy({ id: 2, transactionDate: "2016-01-01" }),
      buy({ id: 3, transactionDate: "2020-06-01" }),
      buy({ id: 4, transactionDate: "2020-07-01" }),
    ],
    3
  );
  assert.equal(trades.length, 2);
  assert.equal(trades[0].firstEverPurchase, true);
  assert.equal(trades[0].buy.id, 1);
  assert.equal(trades[1].firstEverPurchase, false);
  assert.equal(trades[1].buy.id, 3);
  assert.ok((trades[1].yearsSinceLastBuy ?? 0) >= 3);
});

test("score and labels", () => {
  assert.equal(
    computeFirstTimeBuyerScore({
      yearsScore: 100,
      valueScore: 100,
      roleScore: 100,
      firstEverScore: 100,
      sharesScore: 100,
    }),
    100
  );
  assert.equal(firstTimeBuyerClassification(90), "First-Time High Conviction");
  assert.equal(firstTimeBuyerClassification(75), "Long-Term Return Buyer");
  assert.equal(firstTimeBuyerClassification(50), "Notable Return");
  assert.equal(firstTimeBuyerClassification(10), "Minor Purchase");
  assert.equal(yearsSinceLastBuyScore(null, true), 100);
  assert.ok(yearsSinceLastBuyScore(5, false) > yearsSinceLastBuyScore(3, false));
});

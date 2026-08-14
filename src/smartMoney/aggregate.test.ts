import assert from "node:assert/strict";
import test from "node:test";
import { filerShareFlow, intersectSmartMoneyTickers } from "./aggregate.js";

test("intersectSmartMoneyTickers requires institutional, insider, and congress", () => {
  const institutional = new Map([
    ["AAPL", 1],
    ["MSFT", 2],
    ["GOOG", 3],
  ]);
  const insider = new Map([
    ["AAPL", 10],
    ["MSFT", 20],
    ["TSLA", 30],
  ]);
  const politician = new Map([
    ["AAPL", 100],
    ["NVDA", 200],
    ["MSFT", 300],
  ]);

  assert.deepEqual(intersectSmartMoneyTickers(institutional, insider, politician), ["AAPL", "MSFT"]);
});

test("filerShareFlow ignores price-style notional and uses percent share change", () => {
  const aum = Math.E - 1;
  assert.equal(filerShareFlow(110, 100, aum), 10 / 110);
  assert.equal(filerShareFlow(100, 100, aum), 0);
  assert.equal(filerShareFlow(100, 0, aum), 1);
  assert.equal(filerShareFlow(0, 100, aum), -1);
});

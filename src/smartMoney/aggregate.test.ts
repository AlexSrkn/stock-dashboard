import assert from "node:assert/strict";
import test from "node:test";
import { intersectSmartMoneyTickers } from "./aggregate.js";

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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  doubleTripleWindowDays,
  institutionalChartQuarters,
  parseComparePeriod,
  periodStartDate,
} from "./period.js";
import { higherActivitySide } from "./StockComparisonPage.js";

describe("stock compare period helpers", () => {
  it("parses period aliases", () => {
    assert.equal(parseComparePeriod("latest"), "latest");
    assert.equal(parseComparePeriod("2q"), "2q");
    assert.equal(parseComparePeriod("4"), "4q");
    assert.equal(parseComparePeriod("365d"), "12m");
    assert.equal(parseComparePeriod("all"), "all");
  });

  it("maps windows without inventing sync", () => {
    assert.equal(doubleTripleWindowDays("latest"), 90);
    assert.equal(doubleTripleWindowDays("2q"), 180);
    assert.equal(institutionalChartQuarters("latest"), 2);
    assert.equal(periodStartDate("all"), null);
  });

  it("marks higher activity without calling it better", () => {
    assert.equal(higherActivitySide(10, 3), "A");
    assert.equal(higherActivitySide(1, 5), "B");
    assert.equal(higherActivitySide(4, 4), "tie");
    assert.equal(higherActivitySide(null, null), "none");
  });
});

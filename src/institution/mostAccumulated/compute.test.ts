import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePercentIncrease } from "./compute.js";

describe("computePercentIncrease", () => {
  it("returns normal accumulation percentages", () => {
    assert.equal(
      computePercentIncrease({
        netSharesAdded: 50_000,
        previousTotalShares: 100_000,
        currentTotalShares: 150_000,
      }),
      50
    );
  });

  it("returns null for SIND-style tiny prior bases", () => {
    assert.equal(
      computePercentIncrease({
        netSharesAdded: 122_990_000,
        previousTotalShares: 185,
        currentTotalShares: 123_000_000,
      }),
      null
    );
  });

  it("returns null when prior is a tiny share of current", () => {
    assert.equal(
      computePercentIncrease({
        netSharesAdded: 17_000_000,
        previousTotalShares: 100,
        currentTotalShares: 17_000_100,
      }),
      null
    );
  });

  it("returns null when prior is zero and net is positive", () => {
    assert.equal(
      computePercentIncrease({
        netSharesAdded: 1_000_000,
        previousTotalShares: 0,
        currentTotalShares: 1_000_000,
      }),
      null
    );
  });

  it("returns 0 when both sides are flat at zero prior", () => {
    assert.equal(
      computePercentIncrease({
        netSharesAdded: 0,
        previousTotalShares: 0,
        currentTotalShares: 0,
      }),
      0
    );
  });

  it("returns null when abs percent exceeds the display cap", () => {
    assert.equal(
      computePercentIncrease({
        netSharesAdded: 2_000_000,
        previousTotalShares: 100_000,
        currentTotalShares: 2_100_000,
      }),
      null
    );
  });
});

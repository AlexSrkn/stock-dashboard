import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentSaleStreak,
  detectMultiplePoliticianSellers,
  saleStreaks,
} from "./detect.js";

describe("saleStreaks", () => {
  it("counts uninterrupted sell sequences", () => {
    assert.deepEqual(saleStreaks(["sell", "sell", "sell"]), { current: 3, previous: 0 });
    assert.deepEqual(saleStreaks(["sell", "sell", "buy", "sell"]), {
      current: 1,
      previous: 2,
    });
    assert.deepEqual(saleStreaks(["sell", "sell", "sell", "buy"]), {
      current: 0,
      previous: 3,
    });
  });

  it("exposes currentSaleStreak helper", () => {
    assert.equal(currentSaleStreak(["sell", "buy", "sell", "sell"]), 2);
  });
});

describe("detectMultiplePoliticianSellers", () => {
  const day = 86_400_000;
  const base = Date.UTC(2026, 0, 1);

  it("flags 3+ unique sellers in window", () => {
    const hit = detectMultiplePoliticianSellers(
      [
        { politicianKey: "a", dateMs: base, estimatedValue: 1000, party: "Democrat", chamber: "senate" },
        {
          politicianKey: "b",
          dateMs: base + 5 * day,
          estimatedValue: 2000,
          party: "Republican",
          chamber: "house",
        },
        {
          politicianKey: "c",
          dateMs: base + 10 * day,
          estimatedValue: 3000,
          party: "Democrat",
          chamber: "house",
        },
      ],
      30,
      3
    );
    assert.equal(hit.multipleSellers, true);
    assert.equal(hit.peakUniqueSellers, 3);
    assert.equal(hit.democratSellers, 2);
    assert.equal(hit.republicanSellers, 1);
    assert.equal(hit.senatorSellers, 1);
    assert.equal(hit.representativeSellers, 2);
  });

  it("does not flag sellers outside the window", () => {
    const miss = detectMultiplePoliticianSellers(
      [
        { politicianKey: "a", dateMs: base, estimatedValue: 1000, party: "Democrat", chamber: "senate" },
        {
          politicianKey: "b",
          dateMs: base + 40 * day,
          estimatedValue: 2000,
          party: "Republican",
          chamber: "house",
        },
        {
          politicianKey: "c",
          dateMs: base + 80 * day,
          estimatedValue: 3000,
          party: "Democrat",
          chamber: "house",
        },
      ],
      30,
      3
    );
    assert.equal(miss.multipleSellers, false);
    assert.ok(miss.peakUniqueSellers < 3);
  });
});

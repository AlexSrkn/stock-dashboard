import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculatePeValuation,
  impliedSharePrice,
  resolveEps,
  validatePeInputs,
} from "./calculate.js";
import type { PeCalculateInputs } from "./types.js";

function base(over: Partial<PeCalculateInputs> = {}): PeCalculateInputs {
  return {
    diluted_eps: 5,
    net_income: 5_000_000_000,
    shares_outstanding: 1_000_000_000,
    current_share_price: 100,
    target_pe: 20,
    ...over,
  };
}

describe("resolveEps", () => {
  it("prefers reported diluted EPS", () => {
    const r = resolveEps({
      diluted_eps: 5.25,
      net_income: 1e9,
      shares_outstanding: 1e9,
    });
    assert.equal(r.eps, 5.25);
    assert.equal(r.source, "reported");
  });

  it("derives EPS from net income / shares", () => {
    const r = resolveEps({
      diluted_eps: null,
      net_income: 4e9,
      shares_outstanding: 1e9,
    });
    assert.equal(r.eps, 4);
    assert.equal(r.source, "derived");
  });
});

describe("impliedSharePrice", () => {
  it("computes EPS × P/E", () => {
    assert.equal(impliedSharePrice(5, 20), 100);
  });

  it("rejects invalid P/E", () => {
    assert.equal(impliedSharePrice(5, 0), null);
    assert.equal(impliedSharePrice(5, -10), null);
  });
});

describe("validatePeInputs", () => {
  it("rejects zero EPS", () => {
    const errors = validatePeInputs(base({ diluted_eps: 0 }));
    assert.ok(errors.some((e) => e.includes("zero")));
  });

  it("rejects invalid P/E", () => {
    const errors = validatePeInputs(base({ target_pe: 0 }));
    assert.ok(errors.some((e) => e.includes("P/E")));
  });

  it("rejects missing EPS and shares", () => {
    const errors = validatePeInputs(
      base({ diluted_eps: null, net_income: null, shares_outstanding: null })
    );
    assert.ok(errors.some((e) => e.includes("EPS")));
  });
});

describe("calculatePeValuation", () => {
  it("computes implied price and upside", () => {
    const r = calculatePeValuation(base());
    assert.equal(r.ok, true);
    assert.equal(r.implied_share_price, 100);
    assert.equal(r.implied_upside, 0);
  });

  it("handles negative EPS without NaN", () => {
    const r = calculatePeValuation(base({ diluted_eps: -2, target_pe: 15 }));
    assert.equal(r.ok, true);
    assert.equal(r.implied_share_price, -30);
    assert.ok(Number.isFinite(r.implied_share_price!));
  });

  it("builds bear/base/bull scenarios", () => {
    const r = calculatePeValuation(base());
    assert.equal(r.scenarios.length, 3);
    assert.equal(r.scenarios[0].implied_share_price, 75);
    assert.equal(r.scenarios[1].implied_share_price, 100);
    assert.equal(r.scenarios[2].implied_share_price, 125);
  });

  it("omits upside when price missing", () => {
    const r = calculatePeValuation(base({ current_share_price: null }));
    assert.equal(r.implied_upside, null);
  });

  it("never returns NaN or Infinity", () => {
    const r = calculatePeValuation(base({ diluted_eps: 0, target_pe: null as unknown as number }));
    assert.equal(r.ok, false);
    assert.equal(r.implied_share_price, null);
  });
});

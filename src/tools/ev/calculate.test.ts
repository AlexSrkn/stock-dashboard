import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateEnterpriseValue,
  resolveMarketCap,
  validateEvInputs,
} from "./calculate.js";
import type { EvCalculateInputs } from "./types.js";

function base(over: Partial<EvCalculateInputs> = {}): EvCalculateInputs {
  return {
    current_share_price: 100,
    shares_outstanding: 1_000_000_000,
    market_cap: null,
    total_debt: 30_000_000_000,
    cash: 20_000_000_000,
    ...over,
  };
}

describe("resolveMarketCap", () => {
  it("uses price × shares when both available", () => {
    const r = resolveMarketCap(base());
    assert.equal(r.market_cap, 100e9);
    assert.equal(r.source, "price_times_shares");
  });

  it("uses manual market cap when mode is manual", () => {
    const r = resolveMarketCap(
      base({ market_cap_mode: "manual", market_cap: 90e9, current_share_price: null })
    );
    assert.equal(r.market_cap, 90e9);
    assert.equal(r.source, "manual");
  });

  it("falls back to manual cap when price/shares missing", () => {
    const r = resolveMarketCap(
      base({ current_share_price: null, shares_outstanding: null, market_cap: 80e9 })
    );
    assert.equal(r.market_cap, 80e9);
    assert.equal(r.source, "manual");
  });

  it("rejects zero/negative shares", () => {
    const r = resolveMarketCap(base({ shares_outstanding: 0 }));
    assert.equal(r.market_cap, null);
    assert.ok(r.errors.some((e) => e.includes("Shares")));
  });
});

describe("validateEvInputs", () => {
  it("requires debt and cash", () => {
    const errors = validateEvInputs(base({ total_debt: null, cash: null }));
    assert.ok(errors.some((e) => e.includes("debt")));
    assert.ok(errors.some((e) => e.includes("Cash")));
  });

  it("rejects negative debt/cash", () => {
    const errors = validateEvInputs(base({ total_debt: -1, cash: -1 }));
    assert.ok(errors.some((e) => e.includes("debt")));
    assert.ok(errors.some((e) => e.includes("Cash")));
  });
});

describe("calculateEnterpriseValue", () => {
  it("computes EV = market cap + debt - cash", () => {
    const r = calculateEnterpriseValue(base());
    assert.equal(r.ok, true);
    assert.equal(r.market_cap, 100e9);
    assert.equal(r.enterprise_value, 110e9);
    assert.equal(r.net_debt, 10e9);
    assert.equal(r.bridge.enterprise_value, 110e9);
  });

  it("supports direct market cap entry", () => {
    const r = calculateEnterpriseValue(
      base({
        market_cap_mode: "manual",
        market_cap: 50e9,
        current_share_price: null,
        shares_outstanding: null,
      })
    );
    assert.equal(r.ok, true);
    assert.equal(r.enterprise_value, 60e9);
    assert.equal(r.market_cap_source, "manual");
  });

  it("fails cleanly when inputs missing", () => {
    const r = calculateEnterpriseValue(
      base({
        current_share_price: null,
        shares_outstanding: null,
        market_cap: null,
        total_debt: null,
        cash: null,
      })
    );
    assert.equal(r.ok, false);
    assert.equal(r.enterprise_value, null);
    assert.ok(r.errors.length > 0);
  });

  it("never returns NaN or Infinity", () => {
    const r = calculateEnterpriseValue(
      base({ shares_outstanding: 0, current_share_price: -5 })
    );
    assert.equal(r.ok, false);
    assert.equal(r.enterprise_value, null);
    assert.equal(Number.isNaN(r.enterprise_value as number), false);
  });
});

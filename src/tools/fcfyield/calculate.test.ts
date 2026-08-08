import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateFcfYield,
  calculateYieldRatio,
  resolveFreeCashFlow,
  validateFcfYieldInputs,
} from "./calculate.js";
import type { FcfYieldCalculateInputs } from "./types.js";

function base(over: Partial<FcfYieldCalculateInputs> = {}): FcfYieldCalculateInputs {
  return {
    operating_cash_flow: 20_000_000_000,
    capital_expenditures: 5_000_000_000,
    free_cash_flow: null,
    current_share_price: 100,
    shares_outstanding: 1_000_000_000,
    market_cap: null,
    total_debt: 30_000_000_000,
    cash: 20_000_000_000,
    enterprise_value: null,
    ...over,
  };
}

describe("resolveFreeCashFlow", () => {
  it("computes OCF − CapEx", () => {
    const r = resolveFreeCashFlow({
      operating_cash_flow: 20e9,
      capital_expenditures: 5e9,
      free_cash_flow: null,
    });
    assert.equal(r.fcf, 15e9);
    assert.equal(r.source, "ocf_minus_capex");
  });

  it("uses provided FCF when OCF/CapEx missing", () => {
    const r = resolveFreeCashFlow({
      operating_cash_flow: null,
      capital_expenditures: null,
      free_cash_flow: 12e9,
    });
    assert.equal(r.fcf, 12e9);
    assert.equal(r.source, "provided");
  });

  it("normalizes negative CapEx to absolute outflow", () => {
    const r = resolveFreeCashFlow({
      operating_cash_flow: 20e9,
      capital_expenditures: -5e9,
      free_cash_flow: null,
    });
    assert.equal(r.fcf, 15e9);
  });
});

describe("calculateYieldRatio", () => {
  it("computes FCF / market cap", () => {
    assert.equal(calculateYieldRatio(15e9, 100e9), 0.15);
  });

  it("rejects zero denominator", () => {
    assert.equal(calculateYieldRatio(15e9, 0), null);
  });
});

describe("validateFcfYieldInputs", () => {
  it("rejects missing FCF components", () => {
    const errors = validateFcfYieldInputs(
      base({
        operating_cash_flow: null,
        capital_expenditures: null,
        free_cash_flow: null,
      })
    );
    assert.ok(errors.some((e) => e.includes("Free cash flow")));
  });

  it("rejects missing market cap", () => {
    const errors = validateFcfYieldInputs(
      base({
        current_share_price: null,
        shares_outstanding: null,
        market_cap: null,
      })
    );
    assert.ok(errors.some((e) => e.includes("Market capitalization")));
  });
});

describe("calculateFcfYield", () => {
  it("computes FCF and yields", () => {
    // FCF = 15B; Market Cap = 100B; Yield = 15%
    // EV = 100B + 30B - 20B = 110B; Yield on EV ≈ 13.64%
    const r = calculateFcfYield(base());
    assert.equal(r.ok, true);
    assert.equal(r.free_cash_flow, 15e9);
    assert.equal(r.market_cap, 100e9);
    assert.equal(r.fcf_yield, 0.15);
    assert.equal(r.enterprise_value, 110e9);
    assert.equal(r.fcf_yield_on_ev, 0.1364);
  });

  it("handles negative FCF without NaN", () => {
    const r = calculateFcfYield(
      base({ operating_cash_flow: 1e9, capital_expenditures: 5e9 })
    );
    assert.equal(r.ok, true);
    assert.equal(r.free_cash_flow, -4e9);
    assert.ok(r.fcf_yield! < 0);
    assert.ok(Number.isFinite(r.fcf_yield!));
  });

  it("uses direct market cap and enterprise value overrides", () => {
    const r = calculateFcfYield(
      base({
        current_share_price: null,
        shares_outstanding: null,
        market_cap: 200e9,
        enterprise_value: 220e9,
        enterprise_value_mode: "manual",
        total_debt: null,
        cash: null,
        free_cash_flow: 10e9,
        operating_cash_flow: null,
        capital_expenditures: null,
      })
    );
    assert.equal(r.ok, true);
    assert.equal(r.fcf_yield, 0.05);
    assert.equal(r.fcf_yield_on_ev, 0.0455);
  });

  it("never returns NaN or Infinity on missing inputs", () => {
    const r = calculateFcfYield(
      base({
        operating_cash_flow: null,
        capital_expenditures: null,
        free_cash_flow: null,
        market_cap: null,
        current_share_price: null,
        shares_outstanding: null,
      })
    );
    assert.equal(r.ok, false);
    assert.equal(r.fcf_yield, null);
    assert.equal(r.fcf_yield_on_ev, null);
  });
});

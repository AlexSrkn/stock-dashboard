import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateEvEbitdaValuation,
  impliedEnterpriseValueFromEbitda,
  validateEvEbitdaInputs,
} from "./calculate.js";
import type { EvEbitdaCalculateInputs } from "./types.js";

function base(over: Partial<EvEbitdaCalculateInputs> = {}): EvEbitdaCalculateInputs {
  return {
    ebitda: 10_000_000_000,
    total_debt: 30_000_000_000,
    cash: 20_000_000_000,
    shares_outstanding: 1_000_000_000,
    current_share_price: 100,
    target_multiple: 15,
    ...over,
  };
}

describe("impliedEnterpriseValueFromEbitda", () => {
  it("computes EBITDA × multiple", () => {
    assert.equal(impliedEnterpriseValueFromEbitda(10e9, 15), 150e9);
  });

  it("rejects invalid multiple", () => {
    assert.equal(impliedEnterpriseValueFromEbitda(10e9, 0), null);
  });
});

describe("validateEvEbitdaInputs", () => {
  it("rejects zero EBITDA", () => {
    const errors = validateEvEbitdaInputs(base({ ebitda: 0 }));
    assert.ok(errors.some((e) => e.includes("zero")));
  });

  it("rejects missing debt/cash/shares", () => {
    const errors = validateEvEbitdaInputs(
      base({ total_debt: null, cash: null, shares_outstanding: null })
    );
    assert.ok(errors.some((e) => e.includes("debt")));
    assert.ok(errors.some((e) => e.includes("Cash")));
    assert.ok(errors.some((e) => e.includes("shares")));
  });

  it("rejects invalid multiple", () => {
    const errors = validateEvEbitdaInputs(base({ target_multiple: 0 }));
    assert.ok(errors.some((e) => e.includes("multiple")));
  });
});

describe("calculateEvEbitdaValuation", () => {
  it("computes EV, equity, and share price", () => {
    // EV = 10B × 15 = 150B; Equity = 150B - 30B + 20B = 140B; Price = $140
    const r = calculateEvEbitdaValuation(base());
    assert.equal(r.ok, true);
    assert.equal(r.implied_enterprise_value, 150e9);
    assert.equal(r.implied_equity_value, 140e9);
    assert.equal(r.implied_share_price, 140);
    assert.equal(r.net_debt, 10e9);
  });

  it("handles net cash (cash > debt)", () => {
    const r = calculateEvEbitdaValuation(base({ total_debt: 10e9, cash: 40e9 }));
    assert.equal(r.ok, true);
    assert.equal(r.net_debt, -30e9);
    // Equity = 150B - 10B + 40B = 180B
    assert.equal(r.implied_equity_value, 180e9);
  });

  it("handles net debt", () => {
    const r = calculateEvEbitdaValuation(base({ total_debt: 50e9, cash: 5e9 }));
    assert.equal(r.net_debt, 45e9);
    assert.equal(r.implied_equity_value, 105e9);
  });

  it("builds bear/base/bull scenarios", () => {
    const r = calculateEvEbitdaValuation(base());
    assert.equal(r.scenarios.length, 3);
    // Bear 12x → EV 120B → Equity 110B → $110
    assert.equal(r.scenarios[0].implied_share_price, 110);
    // Base 15x → $140
    assert.equal(r.scenarios[1].implied_share_price, 140);
    // Bull 18x → EV 180B → Equity 170B → $170
    assert.equal(r.scenarios[2].implied_share_price, 170);
  });

  it("handles negative EBITDA without NaN", () => {
    const r = calculateEvEbitdaValuation(base({ ebitda: -2e9, target_multiple: 12 }));
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.implied_enterprise_value!));
    assert.ok(Number.isFinite(r.implied_share_price!));
  });

  it("never returns NaN or Infinity on invalid inputs", () => {
    const r = calculateEvEbitdaValuation(
      base({ ebitda: 0, shares_outstanding: 0, target_multiple: null as unknown as number })
    );
    assert.equal(r.ok, false);
    assert.equal(r.implied_share_price, null);
  });
});

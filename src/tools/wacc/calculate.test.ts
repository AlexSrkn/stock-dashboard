import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateWacc, deriveCapmCostOfEquity, validateWaccInputs } from "./calculate.js";
import type { WaccCalculateInputs } from "./types.js";

function baseInputs(overrides: Partial<WaccCalculateInputs> = {}): WaccCalculateInputs {
  return {
    market_value_equity: 80_000_000_000,
    total_debt: 20_000_000_000,
    cost_of_equity_method: "capm",
    cost_of_equity: null,
    cost_of_debt: 0.05,
    corporate_tax_rate: 0.25,
    risk_free_rate: 0.04,
    beta: 1,
    equity_risk_premium: 0.06,
    ...overrides,
  };
}

describe("deriveCapmCostOfEquity", () => {
  it("computes CAPM cost of equity", () => {
    assert.equal(deriveCapmCostOfEquity(baseInputs()), 0.1);
  });

  it("returns null when CAPM inputs missing", () => {
    assert.equal(deriveCapmCostOfEquity(baseInputs({ beta: null })), null);
  });
});

describe("validateWaccInputs", () => {
  it("rejects negative debt", () => {
    const errors = validateWaccInputs(baseInputs({ total_debt: -1 }));
    assert.ok(errors.some((e) => e.includes("Total debt")));
  });

  it("rejects negative equity value", () => {
    const errors = validateWaccInputs(baseInputs({ market_value_equity: -5 }));
    assert.ok(errors.some((e) => e.includes("Market value of equity")));
  });

  it("rejects tax outside range", () => {
    const errors = validateWaccInputs(baseInputs({ corporate_tax_rate: 1.2 }));
    assert.ok(errors.some((e) => e.includes("Corporate tax rate")));
  });

  it("rejects invalid beta", () => {
    const errors = validateWaccInputs(baseInputs({ beta: -0.2 }));
    assert.ok(errors.some((e) => e.includes("Beta")));
  });

  it("rejects missing CAPM inputs", () => {
    const errors = validateWaccInputs(baseInputs({ equity_risk_premium: null }));
    assert.ok(errors.some((e) => e.includes("Equity risk premium")));
  });

  it("rejects zero total capital", () => {
    const errors = validateWaccInputs(baseInputs({ market_value_equity: 0, total_debt: 0 }));
    assert.ok(errors.some((e) => e.includes("greater than zero")));
  });
});

describe("calculateWacc", () => {
  it("computes WACC from CAPM inputs", () => {
    const result = calculateWacc(baseInputs());
    assert.equal(result.ok, true);
    assert.equal(result.equity_weight, 0.8);
    assert.equal(result.debt_weight, 0.2);
    assert.equal(result.cost_of_equity, 0.1);
    assert.equal(result.after_tax_cost_of_debt, 0.0375);
    assert.equal(result.breakdown.equity_component, 0.08);
    assert.equal(result.breakdown.debt_component, 0.0075);
    assert.equal(result.wacc, 0.0875);
  });

  it("supports manual cost of equity", () => {
    const result = calculateWacc(
      baseInputs({
        cost_of_equity_method: "manual",
        cost_of_equity: 0.11,
      })
    );
    assert.equal(result.ok, true);
    assert.equal(result.cost_of_equity, 0.11);
    assert.equal(result.wacc, 0.0955);
  });

  it("handles zero debt cleanly", () => {
    const result = calculateWacc(baseInputs({ total_debt: 0 }));
    assert.equal(result.ok, true);
    assert.equal(result.debt_weight, 0);
    assert.equal(result.after_tax_cost_of_debt, 0.0375);
    assert.equal(result.wacc, 0.1);
  });

  it("never returns NaN on invalid input", () => {
    const result = calculateWacc(baseInputs({ market_value_equity: null, total_debt: null }));
    assert.equal(result.ok, false);
    assert.equal(Number.isNaN(result.wacc), false);
    assert.equal(result.wacc, null);
  });
});

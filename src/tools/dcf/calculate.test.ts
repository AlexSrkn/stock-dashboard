import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDCF,
  computeUnleveredFcf,
  solveImpliedFcfGrowth,
  validateDcfInputs,
} from "./calculate.js";
import type { DcfCalculateInputs } from "./types.js";

function baseInputs(over: Partial<DcfCalculateInputs> = {}): DcfCalculateInputs {
  return {
    revenue: 100_000_000_000,
    ebit: 10_000_000_000,
    tax_rate: 0.21,
    depreciation: 1_800_000_000,
    capex: 2_400_000_000,
    change_in_working_capital: 700_000_000,
    cash: 20_000_000_000,
    debt: 30_000_000_000,
    shares_outstanding: 1_000_000_000,
    current_share_price: 100,
    ebitda: 11_800_000_000,
    forecast_years: 5,
    growth_method: "fcf_growth",
    fcf_growth_rates: [0.1, 0.1, 0.08, 0.07, 0.05],
    revenue_growth_rates: [0.1, 0.09, 0.08, 0.06, 0.05],
    fcf_margin_current: 0.18,
    fcf_margin_terminal: 0.2,
    wacc: 0.09,
    terminal_method: "perpetual_growth",
    terminal_growth: 0.025,
    exit_ebitda_multiple: 10,
    ...over,
  };
}

describe("computeUnleveredFcf", () => {
  it("matches the worked example components", () => {
    const c = computeUnleveredFcf({
      ebit: 10e9,
      tax_rate: 0.21,
      depreciation: 1.8e9,
      capex: 2.4e9,
      change_in_working_capital: 0.7e9,
    });
    assert.equal(c.tax, 2.1e9);
    assert.equal(c.nopat, 7.9e9);
    assert.equal(c.fcf, 6.6e9);
  });

  it("treats negative CapEx as absolute outflow", () => {
    const c = computeUnleveredFcf({
      ebit: 10e9,
      tax_rate: 0.21,
      depreciation: 1.8e9,
      capex: -2.4e9,
      change_in_working_capital: 0.7e9,
    });
    assert.equal(c.capex, 2.4e9);
    assert.equal(c.fcf, 6.6e9);
  });

  it("returns null FCF when CapEx missing", () => {
    const c = computeUnleveredFcf({
      ebit: 10e9,
      tax_rate: 0.21,
      depreciation: 1.8e9,
      capex: null,
      change_in_working_capital: 0.7e9,
    });
    assert.equal(c.fcf, null);
  });

  it("returns null FCF when working capital missing", () => {
    const c = computeUnleveredFcf({
      ebit: 10e9,
      tax_rate: 0.21,
      depreciation: 1.8e9,
      capex: 2.4e9,
      change_in_working_capital: null,
    });
    assert.equal(c.fcf, null);
  });
});

describe("validateDcfInputs", () => {
  it("rejects WACC <= terminal growth", () => {
    const errors = validateDcfInputs(baseInputs({ wacc: 0.025, terminal_growth: 0.025 }));
    assert.ok(errors.some((e) => e.includes("Terminal growth must be lower")));
  });

  it("rejects zero shares", () => {
    const errors = validateDcfInputs(baseInputs({ shares_outstanding: 0 }));
    assert.ok(errors.some((e) => e.includes("Shares outstanding")));
  });

  it("rejects missing cash", () => {
    const errors = validateDcfInputs(baseInputs({ cash: Number.NaN as unknown as number }));
    assert.ok(errors.some((e) => e.includes("Cash")));
  });

  it("rejects missing debt", () => {
    const errors = validateDcfInputs(baseInputs({ debt: Number.NaN as unknown as number }));
    assert.ok(errors.some((e) => e.includes("debt")));
  });
});

describe("calculateDCF", () => {
  it("computes enterprise / equity / per-share for 5-year perpetual growth", () => {
    const r = calculateDCF(baseInputs());
    assert.equal(r.ok, true);
    assert.equal(r.projected_fcf.length, 5);
    assert.ok(finite(r.pv_forecast_fcf));
    assert.ok(finite(r.pv_terminal_value));
    assert.ok(finite(r.enterprise_value));
    assert.ok(finite(r.equity_value));
    assert.ok(finite(r.intrinsic_value_per_share));
    assert.ok(finite(r.terminal_value_percentage));
    assert.ok(r.terminal_value_percentage! > 0 && r.terminal_value_percentage! < 1);
    assert.ok(!Number.isNaN(r.intrinsic_value_per_share!));
    assert.ok(Number.isFinite(r.intrinsic_value_per_share!));

    // Equity = EV - debt + cash
    assert.equal(
      r.equity_value,
      Math.round((r.enterprise_value! - 30e9 + 20e9) * 100) / 100
    );
  });

  it("supports 10-year forecast", () => {
    const rates = Array.from({ length: 10 }, () => 0.06);
    const r = calculateDCF(
      baseInputs({ forecast_years: 10, fcf_growth_rates: rates, revenue_growth_rates: rates })
    );
    assert.equal(r.ok, true);
    assert.equal(r.projected_fcf.length, 10);
  });

  it("supports exit-multiple terminal value", () => {
    const r = calculateDCF(
      baseInputs({ terminal_method: "exit_multiple", exit_ebitda_multiple: 10 })
    );
    assert.equal(r.ok, true);
    assert.ok(finite(r.terminal_value));
    assert.ok(finite(r.intrinsic_value_per_share));
  });

  it("handles negative base FCF without NaN", () => {
    const r = calculateDCF(
      baseInputs({
        ebit: -1e9,
        depreciation: 0.1e9,
        capex: 0.5e9,
        change_in_working_capital: 0.2e9,
      })
    );
    assert.equal(r.ok, true);
    assert.ok(r.base_fcf! < 0);
    assert.ok(Number.isFinite(r.intrinsic_value_per_share!));
  });

  it("handles negative net debt (cash > debt)", () => {
    const r = calculateDCF(baseInputs({ cash: 50e9, debt: 5e9 }));
    assert.equal(r.ok, true);
    assert.ok(r.equity_value! > r.enterprise_value!);
  });

  it("returns implied upside vs current price", () => {
    const r = calculateDCF(baseInputs({ current_share_price: 50 }));
    assert.ok(finite(r.implied_upside));
  });

  it("omits upside when price missing", () => {
    const r = calculateDCF(baseInputs({ current_share_price: null }));
    assert.equal(r.implied_upside, null);
    assert.equal(r.reverse_dcf.available, false);
  });

  it("builds sensitivity matrix with invalid WACC<=g cells", () => {
    const r = calculateDCF(
      baseInputs({
        sensitivity_wacc: [0.03, 0.05, 0.09],
        sensitivity_terminal_growth: [0.02, 0.04, 0.06],
      })
    );
    assert.ok(r.sensitivity_matrix.length >= 9);
    const invalid = r.sensitivity_matrix.find((c) => c.wacc <= c.terminal_growth);
    assert.ok(invalid);
    assert.equal(invalid!.valid, false);
    assert.equal(invalid!.intrinsic_value_per_share, null);
  });

  it("computes bear/base/bull scenarios and range", () => {
    const r = calculateDCF(baseInputs());
    assert.equal(r.scenarios.length, 3);
    assert.ok(r.scenarios.every((s) => s.label.includes("Case")));
    assert.ok(r.dcf_range);
    assert.ok(r.dcf_range!.low! <= r.dcf_range!.high!);
  });

  it("revenue margin method projects FCF from margins", () => {
    const r = calculateDCF(
      baseInputs({
        growth_method: "revenue_margin",
        fcf_margin_current: 0.18,
        fcf_margin_terminal: 0.2,
      })
    );
    assert.equal(r.ok, true);
    assert.ok(r.projected_fcf[0].revenue != null);
    assert.ok(finite(r.intrinsic_value_per_share));
  });

  it("rejects incomplete filing-like inputs transparently", () => {
    const r = calculateDCF(
      baseInputs({
        capex: null,
        change_in_working_capital: null,
      })
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });
});

describe("solveImpliedFcfGrowth / reverse DCF", () => {
  it("solves a growth rate near the base case", () => {
    const inputs = baseInputs({
      fcf_growth_rates: [0.08, 0.08, 0.08, 0.08, 0.08],
      current_share_price: null,
    });
    const priced = calculateDCF(inputs);
    assert.ok(priced.intrinsic_value_per_share);
    const reverseInputs = baseInputs({
      current_share_price: priced.intrinsic_value_per_share!,
      terminal_growth: 0.025,
      wacc: 0.09,
    });
    const implied = solveImpliedFcfGrowth(reverseInputs);
    assert.equal(implied.available, true);
    assert.ok(finite(implied.implied_fcf_growth));
    assert.ok(Math.abs(implied.implied_fcf_growth! - 0.08) < 0.015);
  });

  it("disables when price missing", () => {
    const implied = solveImpliedFcfGrowth(baseInputs({ current_share_price: null }));
    assert.equal(implied.available, false);
  });
});

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

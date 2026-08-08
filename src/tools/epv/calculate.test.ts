import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateEPV, resolveNormalizedEbit, validateEpvInputs } from "./calculate.js";
import type { EpvCalculateInputs } from "./types.js";

function baseInputs(over: Partial<EpvCalculateInputs> = {}): EpvCalculateInputs {
  return {
    revenue: 100_000_000_000,
    ebit: 10_000_000_000,
    average_ebit: 9_000_000_000,
    tax_rate: 0.21,
    cash: 20_000_000_000,
    debt: 30_000_000_000,
    shares_outstanding: 1_000_000_000,
    current_share_price: 100,
    normalization_method: "normalized_margin",
    normalized_margin: 0.1,
    wacc: 0.09,
    ...over,
  };
}

describe("resolveNormalizedEbit", () => {
  it("uses current EBIT", () => {
    assert.equal(
      resolveNormalizedEbit({
        normalization_method: "current_ebit",
        revenue: 100,
        ebit: 12,
        average_ebit: 9,
        normalized_margin: 0.1,
      }),
      12
    );
  });

  it("uses average EBIT", () => {
    assert.equal(
      resolveNormalizedEbit({
        normalization_method: "average_ebit",
        revenue: 100,
        ebit: 12,
        average_ebit: 9,
        normalized_margin: 0.1,
      }),
      9
    );
  });

  it("uses revenue × margin", () => {
    assert.equal(
      resolveNormalizedEbit({
        normalization_method: "normalized_margin",
        revenue: 100e9,
        ebit: 12e9,
        average_ebit: 9e9,
        normalized_margin: 0.1,
      }),
      10e9
    );
  });
});

describe("validateEpvInputs", () => {
  it("rejects WACC <= 0", () => {
    const errors = validateEpvInputs(baseInputs({ wacc: 0 }));
    assert.ok(errors.some((e) => e.includes("WACC")));
  });

  it("rejects missing shares", () => {
    const errors = validateEpvInputs(baseInputs({ shares_outstanding: 0 }));
    assert.ok(errors.some((e) => e.includes("shares")));
  });

  it("rejects invalid margins", () => {
    const errors = validateEpvInputs(baseInputs({ normalized_margin: 1.5 }));
    assert.ok(errors.some((e) => e.includes("margin")));
  });

  it("rejects zero/negative revenue for margin method", () => {
    const errors = validateEpvInputs(baseInputs({ revenue: 0 }));
    assert.ok(errors.some((e) => e.includes("revenue")));
  });
});

describe("calculateEPV", () => {
  it("computes enterprise / equity / per-share EPV", () => {
    // After-tax = 10B * 0.79 = 7.9B; / 0.09 ≈ 87.777B enterprise
    // Equity = 87.777B - 30B + 20B = 77.777B → $77.78 / share
    const r = calculateEPV(baseInputs());
    assert.equal(r.ok, true);
    assert.equal(r.normalized_ebit, 10e9);
    assert.equal(r.tax, 2.1e9);
    assert.equal(r.normalized_after_tax_earnings, 7.9e9);
    assert.ok(finite(r.enterprise_epv));
    assert.ok(finite(r.equity_epv));
    assert.ok(finite(r.epv_per_share));
    assert.equal(r.enterprise_epv, Math.round((7.9e9 / 0.09) * 100) / 100);
    assert.equal(r.equity_epv, Math.round((r.enterprise_epv! - 30e9 + 20e9) * 100) / 100);
    assert.equal(r.epv_per_share, Math.round((r.equity_epv! / 1e9) * 100) / 100);
  });

  it("handles negative EBIT without NaN", () => {
    const r = calculateEPV(
      baseInputs({
        normalization_method: "current_ebit",
        ebit: -1e9,
      })
    );
    assert.equal(r.ok, true);
    assert.ok(r.normalized_ebit! < 0);
    assert.ok(Number.isFinite(r.epv_per_share!));
  });

  it("omits upside when price missing", () => {
    const r = calculateEPV(baseInputs({ current_share_price: null }));
    assert.equal(r.implied_upside, null);
  });

  it("builds sensitivity matrix", () => {
    const r = calculateEPV(baseInputs());
    assert.ok(r.sensitivity_matrix.length >= 15);
    assert.ok(r.sensitivity_matrix.every((c) => c.valid === false || Number.isFinite(c.epv_per_share!)));
  });

  it("computes bear/base/bull scenarios", () => {
    const r = calculateEPV(baseInputs());
    assert.equal(r.scenarios.length, 3);
    assert.ok(r.epv_range);
    assert.ok(r.epv_range!.low! <= r.epv_range!.high!);
  });

  it("rejects missing debt/cash transparently", () => {
    const r = calculateEPV(baseInputs({ debt: null, cash: null }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
    assert.equal(r.epv_per_share, null);
  });

  it("never returns NaN/Infinity", () => {
    const r = calculateEPV(baseInputs({ wacc: null as unknown as number }));
    assert.equal(r.ok, false);
    assert.equal(Number.isNaN(r.epv_per_share as number), false);
    assert.equal(r.epv_per_share, null);
  });
});

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

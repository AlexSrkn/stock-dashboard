import { normalizeCapex } from "../dcf/calculate.js";
import { calculateEnterpriseValue } from "../ev/calculate.js";
import type { FcfYieldCalculateInputs, FcfYieldCalculateResult } from "./types.js";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * FCF = Operating Cash Flow − Capital Expenditures (CapEx as absolute outflow).
 * Prefers OCF − CapEx when both available (unless mode is manual); otherwise uses provided FCF.
 */
export function resolveFreeCashFlow(inputs: {
  operating_cash_flow: number | null;
  capital_expenditures: number | null;
  free_cash_flow: number | null;
  fcf_mode?: "derived" | "manual";
}): { fcf: number | null; source: "ocf_minus_capex" | "provided" | null } {
  const mode = inputs.fcf_mode ?? "derived";
  const ocf = finite(inputs.operating_cash_flow) ? inputs.operating_cash_flow! : null;
  const capex = normalizeCapex(inputs.capital_expenditures);

  if (mode === "manual" && finite(inputs.free_cash_flow)) {
    return { fcf: roundMoney(inputs.free_cash_flow!), source: "provided" };
  }

  if (ocf != null && capex != null) {
    return { fcf: roundMoney(ocf - capex), source: "ocf_minus_capex" };
  }
  if (finite(inputs.free_cash_flow)) {
    return { fcf: roundMoney(inputs.free_cash_flow!), source: "provided" };
  }
  return { fcf: null, source: null };
}

export function resolveMarketCapForYield(inputs: FcfYieldCalculateInputs): number | null {
  if (finite(inputs.market_cap) && inputs.market_cap! > 0) {
    return roundMoney(inputs.market_cap!);
  }
  if (
    finite(inputs.current_share_price) &&
    inputs.current_share_price! >= 0 &&
    finite(inputs.shares_outstanding) &&
    inputs.shares_outstanding! > 0
  ) {
    return roundMoney(inputs.current_share_price! * inputs.shares_outstanding!);
  }
  return null;
}

export function resolveEnterpriseValueForYield(inputs: FcfYieldCalculateInputs): number | null {
  if (
    inputs.enterprise_value_mode === "manual" &&
    finite(inputs.enterprise_value) &&
    Number.isFinite(inputs.enterprise_value!)
  ) {
    return roundMoney(inputs.enterprise_value!);
  }
  if (
    finite(inputs.enterprise_value) &&
    Number.isFinite(inputs.enterprise_value!) &&
    (!finite(inputs.total_debt) || !finite(inputs.cash))
  ) {
    return roundMoney(inputs.enterprise_value!);
  }
  const marketCap = resolveMarketCapForYield(inputs);
  if (marketCap == null || !finite(inputs.total_debt) || !finite(inputs.cash)) {
    return finite(inputs.enterprise_value) ? roundMoney(inputs.enterprise_value!) : null;
  }
  const ev = calculateEnterpriseValue({
    current_share_price: inputs.current_share_price,
    shares_outstanding: inputs.shares_outstanding,
    market_cap: marketCap,
    market_cap_mode: "manual",
    total_debt: inputs.total_debt,
    cash: inputs.cash,
  });
  return ev.ok ? ev.enterprise_value : null;
}

/** Yield as decimal ratio: FCF / denominator. */
export function calculateYieldRatio(fcf: number, denominator: number): number | null {
  if (!Number.isFinite(fcf) || !Number.isFinite(denominator) || denominator === 0) return null;
  const ratio = fcf / denominator;
  return Number.isFinite(ratio) ? round4(ratio) : null;
}

export function validateFcfYieldInputs(inputs: FcfYieldCalculateInputs): string[] {
  const errors: string[] = [];
  const { fcf } = resolveFreeCashFlow(inputs);
  const marketCap = resolveMarketCapForYield(inputs);

  if (fcf == null) {
    errors.push(
      "Free cash flow is required (provide operating cash flow and CapEx, or enter FCF directly)."
    );
  }

  if (marketCap == null) {
    errors.push(
      "Market capitalization is required (provide share price × shares, or enter market cap)."
    );
  } else if (marketCap <= 0) {
    errors.push("Market capitalization must be greater than zero for FCF yield.");
  }

  if (finite(inputs.shares_outstanding) && inputs.shares_outstanding! <= 0) {
    errors.push("Shares outstanding must be greater than zero.");
  }

  if (finite(inputs.current_share_price) && inputs.current_share_price! < 0) {
    errors.push("Share price must be zero or greater.");
  }

  return errors;
}

export function calculateFcfYield(inputs: FcfYieldCalculateInputs): FcfYieldCalculateResult {
  const errors = validateFcfYieldInputs(inputs);
  const resolved = resolveFreeCashFlow(inputs);
  const ocf = finite(inputs.operating_cash_flow) ? inputs.operating_cash_flow! : null;
  const capex = normalizeCapex(inputs.capital_expenditures);
  const fcf = resolved.fcf;
  const marketCap = resolveMarketCapForYield(inputs);
  const enterpriseValue = resolveEnterpriseValueForYield(inputs);

  const fcfYield =
    fcf != null && marketCap != null && marketCap > 0
      ? calculateYieldRatio(fcf, marketCap)
      : null;
  const fcfYieldOnEv =
    fcf != null && enterpriseValue != null && enterpriseValue !== 0
      ? calculateYieldRatio(fcf, enterpriseValue)
      : null;

  const ok =
    errors.length === 0 &&
    fcf != null &&
    marketCap != null &&
    marketCap > 0 &&
    fcfYield != null &&
    Number.isFinite(fcfYield);

  return {
    ok,
    errors: ok
      ? []
      : errors.length
        ? errors
        : ["Unable to calculate FCF yield with the current inputs."],
    operating_cash_flow: ocf,
    capital_expenditures: capex,
    free_cash_flow: fcf,
    market_cap: marketCap,
    enterprise_value: enterpriseValue,
    fcf_yield: ok ? fcfYield : null,
    fcf_yield_on_ev:
      fcfYieldOnEv != null && Number.isFinite(fcfYieldOnEv) ? fcfYieldOnEv : null,
    bridge: {
      operating_cash_flow: ocf,
      capital_expenditures: capex,
      free_cash_flow: fcf,
      market_cap: marketCap,
      fcf_yield: ok ? fcfYield : null,
      enterprise_value: enterpriseValue,
      fcf_yield_on_ev:
        fcfYieldOnEv != null && Number.isFinite(fcfYieldOnEv) ? fcfYieldOnEv : null,
    },
  };
}

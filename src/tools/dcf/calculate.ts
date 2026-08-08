import type {
  DcfCalculateInputs,
  DcfCalculateResult,
  DcfScenarioResult,
  DcfSensitivityCell,
  DcfYearProjection,
  ScenarioId,
} from "./types.js";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundShare(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** CapEx as a positive cash outflow for FCFF. */
export function normalizeCapex(capex: number | null | undefined): number | null {
  if (!finite(capex)) return null;
  return Math.abs(capex);
}

export function computeUnleveredFcf(parts: {
  ebit: number | null;
  tax_rate: number | null;
  depreciation: number | null;
  capex: number | null;
  change_in_working_capital: number | null;
}): {
  ebit: number | null;
  tax: number | null;
  nopat: number | null;
  depreciation: number | null;
  capex: number | null;
  change_in_working_capital: number | null;
  fcf: number | null;
} {
  const ebit = finite(parts.ebit) ? parts.ebit : null;
  const taxRate = finite(parts.tax_rate) ? parts.tax_rate : null;
  const da = finite(parts.depreciation) ? parts.depreciation : null;
  const capex = normalizeCapex(parts.capex);
  const nwc = finite(parts.change_in_working_capital) ? parts.change_in_working_capital : null;

  if (ebit == null || taxRate == null || da == null || capex == null || nwc == null) {
    return {
      ebit,
      tax: ebit != null && taxRate != null ? roundMoney(ebit * taxRate) : null,
      nopat: ebit != null && taxRate != null ? roundMoney(ebit * (1 - taxRate)) : null,
      depreciation: da,
      capex,
      change_in_working_capital: nwc,
      fcf: null,
    };
  }

  const tax = roundMoney(ebit * taxRate);
  const nopat = roundMoney(ebit * (1 - taxRate));
  const fcf = roundMoney(nopat + da - capex - nwc);
  return {
    ebit,
    tax,
    nopat,
    depreciation: da,
    capex,
    change_in_working_capital: nwc,
    fcf,
  };
}

export function validateDcfInputs(inputs: DcfCalculateInputs): string[] {
  const errors: string[] = [];
  const years = inputs.forecast_years;
  if (![5, 7, 10].includes(years)) {
    errors.push("Forecast period must be 5, 7, or 10 years.");
  }
  if (!finite(inputs.wacc) || inputs.wacc <= 0 || inputs.wacc >= 1) {
    errors.push("WACC must be a positive rate below 100%.");
  }
  if (!finite(inputs.tax_rate) || inputs.tax_rate! < 0 || inputs.tax_rate! >= 1) {
    errors.push("Tax rate is required (enter manually if not available from filings).");
  }
  if (!finite(inputs.shares_outstanding) || inputs.shares_outstanding! <= 0) {
    errors.push("Shares outstanding must be greater than zero.");
  }
  if (!finite(inputs.cash)) {
    errors.push("Cash is required (enter manually if not available from filings).");
  }
  if (!finite(inputs.debt)) {
    errors.push("Total debt is required (enter manually if not available from filings).");
  }
  if (inputs.terminal_method === "perpetual_growth") {
    if (!finite(inputs.terminal_growth)) {
      errors.push("Terminal growth rate is required.");
    } else if (finite(inputs.wacc) && inputs.wacc <= inputs.terminal_growth) {
      errors.push("Terminal growth must be lower than the discount rate.");
    }
  } else if (inputs.terminal_method === "exit_multiple") {
    if (!finite(inputs.exit_ebitda_multiple) || inputs.exit_ebitda_multiple <= 0) {
      errors.push("Exit EV/EBITDA multiple must be positive.");
    }
    if (!finite(inputs.ebitda) && !finite(inputs.ebit)) {
      errors.push("EBITDA (or EBIT) is required for the exit-multiple method.");
    }
  }

  if (inputs.growth_method === "fcf_growth") {
    const rates = inputs.fcf_growth_rates || [];
    if (rates.length < years) {
      errors.push("Provide a FCF growth rate for each forecast year.");
    }
    for (let i = 0; i < Math.min(rates.length, years); i++) {
      if (!finite(rates[i]) || rates[i] <= -1) {
        errors.push(`Year ${i + 1} FCF growth rate is invalid.`);
        break;
      }
    }
  } else {
    const rates = inputs.revenue_growth_rates || [];
    if (rates.length < years) {
      errors.push("Provide a revenue growth rate for each forecast year.");
    }
    if (!finite(inputs.revenue) || inputs.revenue <= 0) {
      errors.push("Revenue is required for the revenue-growth method.");
    }
    if (!finite(inputs.fcf_margin_current) || !finite(inputs.fcf_margin_terminal)) {
      errors.push("Current and terminal FCF margins are required.");
    }
  }

  const components = computeUnleveredFcf({
    ebit: inputs.ebit,
    tax_rate: inputs.tax_rate,
    depreciation: inputs.depreciation,
    capex: inputs.capex,
    change_in_working_capital: inputs.change_in_working_capital,
  });
  if (inputs.growth_method === "fcf_growth" && components.fcf == null) {
    errors.push("Base free cash flow cannot be calculated — fill EBIT, tax rate, D&A, CapEx, and change in WC.");
  }

  return errors;
}

function projectFcfSeries(inputs: DcfCalculateInputs, baseFcf: number): DcfYearProjection[] {
  const years = inputs.forecast_years;
  const wacc = inputs.wacc;
  const out: DcfYearProjection[] = [];

  if (inputs.growth_method === "fcf_growth") {
    let fcf = baseFcf;
    for (let y = 1; y <= years; y++) {
      const g = inputs.fcf_growth_rates[y - 1] ?? 0;
      fcf = roundMoney(fcf * (1 + g));
      const discount = 1 / Math.pow(1 + wacc, y);
      out.push({
        year: y,
        revenue: null,
        ebit: null,
        tax: null,
        depreciation: null,
        capex: null,
        change_in_working_capital: null,
        fcf,
        discount_factor: roundPct(discount),
        present_value: roundMoney(fcf * discount),
      });
    }
    return out;
  }

  const rev0 = inputs.revenue!;
  const margin0 = inputs.fcf_margin_current!;
  const marginT = inputs.fcf_margin_terminal!;
  let revenue = rev0;
  for (let y = 1; y <= years; y++) {
    const g = inputs.revenue_growth_rates[y - 1] ?? 0;
    revenue = roundMoney(revenue * (1 + g));
    const t = years <= 1 ? 1 : (y - 1) / (years - 1);
    const margin = margin0 + (marginT - margin0) * t;
    const fcf = roundMoney(revenue * margin);
    const discount = 1 / Math.pow(1 + wacc, y);
    const ebitMargin =
      finite(inputs.ebit) && rev0 > 0 ? inputs.ebit / rev0 : null;
    const ebit = ebitMargin != null ? roundMoney(revenue * ebitMargin) : null;
    const tax = ebit != null ? roundMoney(ebit * inputs.tax_rate) : null;
    out.push({
      year: y,
      revenue,
      ebit,
      tax,
      depreciation: null,
      capex: null,
      change_in_working_capital: null,
      fcf,
      discount_factor: roundPct(discount),
      present_value: roundMoney(fcf * discount),
    });
  }
  return out;
}

function terminalValue(
  inputs: DcfCalculateInputs,
  projections: DcfYearProjection[]
): number | null {
  if (!projections.length) return null;
  const last = projections[projections.length - 1];
  if (inputs.terminal_method === "perpetual_growth") {
    if (inputs.wacc <= inputs.terminal_growth) return null;
    return roundMoney(
      (last.fcf * (1 + inputs.terminal_growth)) / (inputs.wacc - inputs.terminal_growth)
    );
  }
  // Exit multiple on terminal EBITDA. Grow base EBITDA with last FCF growth / revenue growth.
  let ebitda = finite(inputs.ebitda)
    ? inputs.ebitda
    : finite(inputs.ebit) && finite(inputs.depreciation)
      ? inputs.ebit + Math.abs(inputs.depreciation)
      : null;
  if (ebitda == null) return null;
  if (inputs.growth_method === "fcf_growth") {
    for (let y = 0; y < inputs.forecast_years; y++) {
      ebitda = ebitda * (1 + (inputs.fcf_growth_rates[y] ?? 0));
    }
  } else {
    for (let y = 0; y < inputs.forecast_years; y++) {
      ebitda = ebitda * (1 + (inputs.revenue_growth_rates[y] ?? 0));
    }
  }
  return roundMoney(ebitda * inputs.exit_ebitda_multiple);
}

function buildResultFromProjections(
  inputs: DcfCalculateInputs,
  components: ReturnType<typeof computeUnleveredFcf>,
  projections: DcfYearProjection[],
  includeExtras: boolean
): Omit<DcfCalculateResult, "sensitivity_matrix" | "scenarios" | "reverse_dcf" | "dcf_range" | "ok" | "errors"> {
  const tv = terminalValue(inputs, projections);
  const years = inputs.forecast_years;
  const pvForecast = roundMoney(projections.reduce((s, p) => s + p.present_value, 0));
  const pvTerminal =
    tv != null ? roundMoney(tv / Math.pow(1 + inputs.wacc, years)) : null;
  const enterprise =
    pvTerminal != null ? roundMoney(pvForecast + pvTerminal) : null;
  const equity =
    enterprise != null && finite(inputs.debt) && finite(inputs.cash)
      ? roundMoney(enterprise - inputs.debt! + inputs.cash!)
      : null;
  const intrinsic =
    equity != null && finite(inputs.shares_outstanding) && inputs.shares_outstanding! > 0
      ? roundShare(equity / inputs.shares_outstanding!)
      : null;
  const upside =
    intrinsic != null && finite(inputs.current_share_price) && inputs.current_share_price! > 0
      ? roundPct(intrinsic / inputs.current_share_price! - 1)
      : null;
  const tvPct =
    enterprise != null && enterprise !== 0 && pvTerminal != null
      ? roundPct(pvTerminal / enterprise)
      : null;

  return {
    base_fcf: components.fcf,
    fcf_components: components,
    projected_fcf: projections,
    terminal_value: tv,
    pv_forecast_fcf: pvForecast,
    pv_terminal_value: pvTerminal,
    enterprise_value: enterprise,
    equity_value: equity,
    intrinsic_value_per_share: intrinsic,
    implied_upside: upside,
    terminal_value_percentage: tvPct,
  };
}

function emptyResult(errors: string[]): DcfCalculateResult {
  return {
    ok: false,
    errors,
    base_fcf: null,
    fcf_components: {
      ebit: null,
      tax: null,
      nopat: null,
      depreciation: null,
      capex: null,
      change_in_working_capital: null,
      fcf: null,
    },
    projected_fcf: [],
    terminal_value: null,
    pv_forecast_fcf: null,
    pv_terminal_value: null,
    enterprise_value: null,
    equity_value: null,
    intrinsic_value_per_share: null,
    implied_upside: null,
    terminal_value_percentage: null,
    sensitivity_matrix: [],
    scenarios: [],
    reverse_dcf: { available: false, implied_fcf_growth: null, message: null },
    dcf_range: null,
  };
}

function withGrowthRates(inputs: DcfCalculateInputs, constantGrowth: number): DcfCalculateInputs {
  const rates = Array.from({ length: inputs.forecast_years }, () => constantGrowth);
  return {
    ...inputs,
    growth_method: "fcf_growth",
    fcf_growth_rates: rates,
    terminal_method: "perpetual_growth",
  };
}

/**
 * Solve for constant FCF growth g such that equity value ≈ market equity
 * (price × shares). Uses bisection on g ∈ [-50%, 80%].
 */
export function solveImpliedFcfGrowth(inputs: DcfCalculateInputs): {
  available: boolean;
  implied_fcf_growth: number | null;
  message: string | null;
} {
  if (!finite(inputs.current_share_price) || inputs.current_share_price! <= 0) {
    return {
      available: false,
      implied_fcf_growth: null,
      message: "Enter current price manually to enable Reverse DCF.",
    };
  }
  if (!finite(inputs.shares_outstanding) || inputs.shares_outstanding! <= 0) {
    return {
      available: false,
      implied_fcf_growth: null,
      message: "Shares outstanding required for Reverse DCF.",
    };
  }
  const targetEquity = inputs.current_share_price! * inputs.shares_outstanding!;
  const components = computeUnleveredFcf({
    ebit: inputs.ebit,
    tax_rate: inputs.tax_rate,
    depreciation: inputs.depreciation,
    capex: inputs.capex,
    change_in_working_capital: inputs.change_in_working_capital,
  });
  if (components.fcf == null) {
    return {
      available: false,
      implied_fcf_growth: null,
      message: "Base FCF required for Reverse DCF.",
    };
  }

  const equityAt = (g: number): number | null => {
    const trial = withGrowthRates(
      {
        ...inputs,
        terminal_method: "perpetual_growth",
        terminal_growth: Math.min(inputs.terminal_growth, inputs.wacc - 0.005),
      },
      g
    );
    if (trial.wacc <= trial.terminal_growth) return null;
    const proj = projectFcfSeries(trial, components.fcf!);
    const core = buildResultFromProjections(trial, components, proj, false);
    return core.equity_value;
  };

  let lo = -0.5;
  let hi = 0.8;
  const eLo = equityAt(lo);
  const eHi = equityAt(hi);
  if (eLo == null || eHi == null) {
    return {
      available: false,
      implied_fcf_growth: null,
      message: "Could not solve implied growth under current WACC / terminal assumptions.",
    };
  }
  // If target outside range, clamp to nearest endpoint.
  if (targetEquity <= eLo) {
    return { available: true, implied_fcf_growth: roundPct(lo), message: null };
  }
  if (targetEquity >= eHi) {
    return { available: true, implied_fcf_growth: roundPct(hi), message: null };
  }

  let mid = 0;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    const e = equityAt(mid);
    if (e == null) break;
    if (e < targetEquity) lo = mid;
    else hi = mid;
  }
  return { available: true, implied_fcf_growth: roundPct((lo + hi) / 2), message: null };
}

const DEFAULT_SCENARIOS: Record<
  ScenarioId,
  { fcf_growth: number; wacc: number; terminal_growth: number; label: string }
> = {
  bear: { fcf_growth: 0.04, wacc: 0.1, terminal_growth: 0.02, label: "Bear Case" },
  base: { fcf_growth: 0.08, wacc: 0.09, terminal_growth: 0.025, label: "Base Case" },
  bull: { fcf_growth: 0.12, wacc: 0.08, terminal_growth: 0.03, label: "Bull Case" },
};

export function calculateDCF(inputs: DcfCalculateInputs): DcfCalculateResult {
  const errors = validateDcfInputs(inputs);
  const components = computeUnleveredFcf({
    ebit: inputs.ebit,
    tax_rate: inputs.tax_rate,
    depreciation: inputs.depreciation,
    capex: inputs.capex,
    change_in_working_capital: inputs.change_in_working_capital,
  });

  if (errors.length) {
    const empty = emptyResult(errors);
    empty.fcf_components = components;
    empty.base_fcf = components.fcf;
    return empty;
  }

  const baseFcf =
    inputs.growth_method === "revenue_margin"
      ? roundMoney((inputs.revenue || 0) * (inputs.fcf_margin_current || 0))
      : components.fcf!;

  const projections = projectFcfSeries(inputs, baseFcf);
  const core = buildResultFromProjections(inputs, components, projections, true);

  // Sensitivity matrix
  const waccAxis =
    inputs.sensitivity_wacc?.filter((x) => finite(x) && x > 0) ??
    [0.07, 0.08, 0.09, 0.1, 0.11];
  const gAxis =
    inputs.sensitivity_terminal_growth?.filter((x) => finite(x)) ??
    [0.01, 0.02, 0.03, 0.04];
  const sensitivity_matrix: DcfSensitivityCell[] = [];
  for (const g of gAxis) {
    for (const w of waccAxis) {
      if (inputs.terminal_method === "perpetual_growth" && w <= g) {
        sensitivity_matrix.push({
          wacc: w,
          terminal_growth: g,
          intrinsic_value_per_share: null,
          valid: false,
        });
        continue;
      }
      const trial: DcfCalculateInputs = {
        ...inputs,
        wacc: w,
        terminal_growth: g,
        terminal_method: "perpetual_growth",
      };
      const trialErrors = validateDcfInputs(trial);
      if (trialErrors.length) {
        sensitivity_matrix.push({
          wacc: w,
          terminal_growth: g,
          intrinsic_value_per_share: null,
          valid: false,
        });
        continue;
      }
      const proj = projectFcfSeries(trial, baseFcf);
      const r = buildResultFromProjections(trial, components, proj, false);
      sensitivity_matrix.push({
        wacc: w,
        terminal_growth: g,
        intrinsic_value_per_share: r.intrinsic_value_per_share,
        valid: r.intrinsic_value_per_share != null,
      });
    }
  }

  // Scenarios
  const scenarioDefs = {
    ...DEFAULT_SCENARIOS,
    ...(inputs.scenarios
      ? {
          bear: { ...DEFAULT_SCENARIOS.bear, ...inputs.scenarios.bear },
          base: { ...DEFAULT_SCENARIOS.base, ...inputs.scenarios.base },
          bull: { ...DEFAULT_SCENARIOS.bull, ...inputs.scenarios.bull },
        }
      : {}),
  };

  const scenarios: DcfScenarioResult[] = (["bear", "base", "bull"] as ScenarioId[]).map(
    (id) => {
      const def = scenarioDefs[id];
      const trial = withGrowthRates(
        {
          ...inputs,
          wacc: def.wacc,
          terminal_growth: def.terminal_growth,
          terminal_method: "perpetual_growth",
        },
        def.fcf_growth
      );
      const trialErrors = validateDcfInputs(trial);
      if (trialErrors.length || components.fcf == null) {
        return {
          id,
          label: def.label,
          fcf_growth: def.fcf_growth,
          wacc: def.wacc,
          terminal_growth: def.terminal_growth,
          intrinsic_value_per_share: null,
          error: trialErrors[0] || "Missing base FCF",
        };
      }
      const proj = projectFcfSeries(trial, components.fcf);
      const r = buildResultFromProjections(trial, components, proj, false);
      return {
        id,
        label: def.label,
        fcf_growth: def.fcf_growth,
        wacc: def.wacc,
        terminal_growth: def.terminal_growth,
        intrinsic_value_per_share: r.intrinsic_value_per_share,
        error: null,
      };
    }
  );

  const values = scenarios
    .map((s) => s.intrinsic_value_per_share)
    .filter((v): v is number => finite(v));
  const dcf_range =
    values.length >= 2
      ? { low: Math.min(...values), high: Math.max(...values) }
      : values.length === 1
        ? { low: values[0], high: values[0] }
        : null;

  const reverse_dcf = solveImpliedFcfGrowth(inputs);

  return {
    ok: true,
    errors: [],
    ...core,
    sensitivity_matrix,
    scenarios,
    reverse_dcf,
    dcf_range,
  };
}

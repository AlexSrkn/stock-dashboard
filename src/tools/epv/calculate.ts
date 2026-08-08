import type {
  EpvCalculateInputs,
  EpvCalculateResult,
  EpvNormalizationMethod,
  EpvScenarioId,
  EpvScenarioResult,
  EpvSensitivityCell,
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

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function resolveNormalizedEbit(inputs: {
  normalization_method: EpvNormalizationMethod;
  revenue: number | null;
  ebit: number | null;
  average_ebit: number | null;
  normalized_margin: number | null;
}): number | null {
  if (inputs.normalization_method === "current_ebit") {
    return finite(inputs.ebit) ? roundMoney(inputs.ebit) : null;
  }
  if (inputs.normalization_method === "average_ebit") {
    return finite(inputs.average_ebit) ? roundMoney(inputs.average_ebit) : null;
  }
  if (
    !finite(inputs.revenue) ||
    inputs.revenue! <= 0 ||
    !finite(inputs.normalized_margin)
  ) {
    return null;
  }
  return roundMoney(inputs.revenue! * inputs.normalized_margin!);
}

export function validateEpvInputs(inputs: EpvCalculateInputs): string[] {
  const errors: string[] = [];
  if (!finite(inputs.wacc) || inputs.wacc! <= 0 || inputs.wacc! >= 1) {
    errors.push("WACC must be a positive rate below 100%.");
  }
  if (!finite(inputs.tax_rate) || inputs.tax_rate! < 0 || inputs.tax_rate! > 1) {
    errors.push("Tax rate must be between 0% and 100%.");
  }
  if (!finite(inputs.cash)) {
    errors.push("Cash is required (enter manually if not available from filings).");
  }
  if (!finite(inputs.debt)) {
    errors.push("Total debt is required (enter manually if not available from filings).");
  }
  if (!finite(inputs.shares_outstanding) || inputs.shares_outstanding! <= 0) {
    errors.push("Diluted shares outstanding must be greater than zero.");
  }

  if (inputs.normalization_method === "current_ebit") {
    if (!finite(inputs.ebit)) {
      errors.push("Current EBIT is required for this normalization method.");
    }
  } else if (inputs.normalization_method === "average_ebit") {
    if (!finite(inputs.average_ebit)) {
      errors.push("Average EBIT is not available from filing history.");
    }
  } else {
    if (!finite(inputs.revenue) || inputs.revenue! <= 0) {
      errors.push("Positive revenue is required for normalized-margin EPV.");
    }
    if (!finite(inputs.normalized_margin) || inputs.normalized_margin! < -1 || inputs.normalized_margin! > 1) {
      errors.push("Normalized operating margin must be between -100% and 100%.");
    }
  }

  return errors;
}

function computeCore(
  inputs: EpvCalculateInputs,
  normalizedEbit: number,
  wacc: number
): {
  tax: number;
  normalized_after_tax_earnings: number;
  enterprise_epv: number;
  equity_epv: number | null;
  epv_per_share: number | null;
  implied_upside: number | null;
} {
  const taxRate = finite(inputs.tax_rate) ? inputs.tax_rate! : 0;
  const tax = roundMoney(normalizedEbit * taxRate);
  const afterTax = roundMoney(normalizedEbit * (1 - taxRate));
  const enterprise = wacc > 0 ? roundMoney(afterTax / wacc) : NaN;
  const equity =
    Number.isFinite(enterprise) && finite(inputs.debt) && finite(inputs.cash)
      ? roundMoney(enterprise - inputs.debt! + inputs.cash!)
      : null;
  const perShare =
    equity != null && finite(inputs.shares_outstanding) && inputs.shares_outstanding! > 0
      ? roundShare(equity / inputs.shares_outstanding!)
      : null;
  const upside =
    perShare != null && finite(inputs.current_share_price) && inputs.current_share_price! > 0
      ? round4(perShare / inputs.current_share_price! - 1)
      : null;

  return {
    tax,
    normalized_after_tax_earnings: afterTax,
    enterprise_epv: Number.isFinite(enterprise) ? enterprise : NaN,
    equity_epv: equity,
    epv_per_share: perShare,
    implied_upside: upside,
  };
}

const DEFAULT_SCENARIOS: Record<
  EpvScenarioId,
  { normalized_margin: number; wacc: number; label: string }
> = {
  bear: { normalized_margin: 0.08, wacc: 0.1, label: "Bear Case" },
  base: { normalized_margin: 0.1, wacc: 0.09, label: "Base Case" },
  bull: { normalized_margin: 0.12, wacc: 0.08, label: "Bull Case" },
};

export function calculateEPV(inputs: EpvCalculateInputs): EpvCalculateResult {
  const errors = validateEpvInputs(inputs);
  const normalizedEbit = resolveNormalizedEbit(inputs);
  const wacc = finite(inputs.wacc) ? inputs.wacc! : null;

  if (errors.length || normalizedEbit == null || wacc == null || wacc <= 0) {
    return {
      ok: false,
      errors: errors.length
        ? errors
        : ["Unable to calculate EPV with the current inputs."],
      normalization_method: inputs.normalization_method,
      normalized_ebit: normalizedEbit,
      tax: null,
      normalized_after_tax_earnings: null,
      wacc,
      enterprise_epv: null,
      equity_epv: null,
      epv_per_share: null,
      implied_upside: null,
      sensitivity_matrix: [],
      scenarios: [],
      epv_range: null,
      bridge: {
        normalized_ebit: normalizedEbit,
        tax: null,
        normalized_after_tax_earnings: null,
        wacc,
        enterprise_epv: null,
        debt: finite(inputs.debt) ? inputs.debt! : null,
        cash: finite(inputs.cash) ? inputs.cash! : null,
        equity_epv: null,
        shares_outstanding: finite(inputs.shares_outstanding) ? inputs.shares_outstanding! : null,
        epv_per_share: null,
      },
    };
  }

  const core = computeCore(inputs, normalizedEbit, wacc);
  if (!Number.isFinite(core.enterprise_epv)) {
    return {
      ok: false,
      errors: ["Enterprise EPV could not be calculated."],
      normalization_method: inputs.normalization_method,
      normalized_ebit: normalizedEbit,
      tax: core.tax,
      normalized_after_tax_earnings: core.normalized_after_tax_earnings,
      wacc,
      enterprise_epv: null,
      equity_epv: null,
      epv_per_share: null,
      implied_upside: null,
      sensitivity_matrix: [],
      scenarios: [],
      epv_range: null,
      bridge: {
        normalized_ebit: normalizedEbit,
        tax: core.tax,
        normalized_after_tax_earnings: core.normalized_after_tax_earnings,
        wacc,
        enterprise_epv: null,
        debt: inputs.debt,
        cash: inputs.cash,
        equity_epv: null,
        shares_outstanding: inputs.shares_outstanding,
        epv_per_share: null,
      },
    };
  }

  const waccAxis =
    inputs.sensitivity_wacc?.filter((x) => finite(x) && x > 0) ??
    [0.08, 0.09, 0.1];
  const marginAxis =
    inputs.sensitivity_margins?.filter((x) => finite(x)) ??
    [0.08, 0.09, 0.1, 0.11, 0.12];

  const sensitivity_matrix: EpvSensitivityCell[] = [];
  for (const margin of marginAxis) {
    for (const w of waccAxis) {
      if (!finite(inputs.revenue) || inputs.revenue! <= 0 || w <= 0) {
        sensitivity_matrix.push({
          wacc: w,
          normalized_margin: margin,
          epv_per_share: null,
          valid: false,
        });
        continue;
      }
      const trialEbit = roundMoney(inputs.revenue! * margin);
      const trial = computeCore({ ...inputs, normalized_margin: margin }, trialEbit, w);
      sensitivity_matrix.push({
        wacc: w,
        normalized_margin: margin,
        epv_per_share: trial.epv_per_share,
        valid: trial.epv_per_share != null && Number.isFinite(trial.epv_per_share),
      });
    }
  }

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

  const scenarios: EpvScenarioResult[] = (["bear", "base", "bull"] as EpvScenarioId[]).map(
    (id) => {
      const def = scenarioDefs[id];
      if (!finite(inputs.revenue) || inputs.revenue! <= 0 || def.wacc <= 0) {
        return {
          id,
          label: def.label,
          normalized_margin: def.normalized_margin,
          wacc: def.wacc,
          epv_per_share: null,
          error: "Revenue and positive WACC required for scenarios.",
        };
      }
      const trialEbit = roundMoney(inputs.revenue! * def.normalized_margin);
      const trial = computeCore(
        { ...inputs, normalized_margin: def.normalized_margin },
        trialEbit,
        def.wacc
      );
      return {
        id,
        label: def.label,
        normalized_margin: def.normalized_margin,
        wacc: def.wacc,
        epv_per_share: trial.epv_per_share,
        error: null,
      };
    }
  );

  const values = scenarios
    .map((s) => s.epv_per_share)
    .filter((v): v is number => finite(v));
  const epv_range =
    values.length >= 2
      ? { low: Math.min(...values), high: Math.max(...values) }
      : values.length === 1
        ? { low: values[0], high: values[0] }
        : null;

  return {
    ok: true,
    errors: [],
    normalization_method: inputs.normalization_method,
    normalized_ebit: normalizedEbit,
    tax: core.tax,
    normalized_after_tax_earnings: core.normalized_after_tax_earnings,
    wacc,
    enterprise_epv: core.enterprise_epv,
    equity_epv: core.equity_epv,
    epv_per_share: core.epv_per_share,
    implied_upside: core.implied_upside,
    sensitivity_matrix,
    scenarios,
    epv_range,
    bridge: {
      normalized_ebit: normalizedEbit,
      tax: core.tax,
      normalized_after_tax_earnings: core.normalized_after_tax_earnings,
      wacc,
      enterprise_epv: core.enterprise_epv,
      debt: inputs.debt,
      cash: inputs.cash,
      equity_epv: core.equity_epv,
      shares_outstanding: inputs.shares_outstanding,
      epv_per_share: core.epv_per_share,
    },
  };
}

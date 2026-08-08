import type { WaccCalculateInputs, WaccCalculateResult } from "./types.js";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function deriveCapmCostOfEquity(parts: {
  risk_free_rate: number | null;
  beta: number | null;
  equity_risk_premium: number | null;
}): number | null {
  const { risk_free_rate, beta, equity_risk_premium } = parts;
  if (!finite(risk_free_rate) || !finite(beta) || !finite(equity_risk_premium)) return null;
  return round4(risk_free_rate + beta * equity_risk_premium);
}

export function validateWaccInputs(inputs: WaccCalculateInputs): string[] {
  const errors: string[] = [];
  if (!finite(inputs.market_value_equity) || inputs.market_value_equity! < 0) {
    errors.push("Market value of equity must be zero or greater.");
  }
  if (!finite(inputs.total_debt) || inputs.total_debt! < 0) {
    errors.push("Total debt must be zero or greater.");
  }
  const totalCapital =
    finite(inputs.market_value_equity) && finite(inputs.total_debt)
      ? inputs.market_value_equity! + inputs.total_debt!
      : null;
  if (!finite(totalCapital) || totalCapital! <= 0) {
    errors.push("Market value of equity plus debt must be greater than zero.");
  }
  if (!finite(inputs.corporate_tax_rate) || inputs.corporate_tax_rate! < 0 || inputs.corporate_tax_rate! > 1) {
    errors.push("Corporate tax rate must be between 0% and 100%.");
  }
  if (!finite(inputs.cost_of_debt) || inputs.cost_of_debt! < 0 || inputs.cost_of_debt! > 1) {
    errors.push("Cost of debt must be between 0% and 100%.");
  }

  if (inputs.cost_of_equity_method === "manual") {
    if (!finite(inputs.cost_of_equity) || inputs.cost_of_equity! < 0 || inputs.cost_of_equity! > 1) {
      errors.push("Cost of equity must be between 0% and 100%.");
    }
  } else {
    if (!finite(inputs.risk_free_rate) || inputs.risk_free_rate! < 0 || inputs.risk_free_rate! > 1) {
      errors.push("Risk-free rate is required for CAPM.");
    }
    if (!finite(inputs.beta) || inputs.beta! < 0 || inputs.beta! > 10) {
      errors.push("Beta must be zero or greater.");
    }
    if (!finite(inputs.equity_risk_premium) || inputs.equity_risk_premium! < 0 || inputs.equity_risk_premium! > 1) {
      errors.push("Equity risk premium is required for CAPM.");
    }
  }

  return errors;
}

export function calculateWacc(inputs: WaccCalculateInputs): WaccCalculateResult {
  const errors = validateWaccInputs(inputs);
  const marketValueEquity = finite(inputs.market_value_equity) ? inputs.market_value_equity! : null;
  const totalDebt = finite(inputs.total_debt) ? inputs.total_debt! : null;
  const totalCapital =
    marketValueEquity != null && totalDebt != null ? round2(marketValueEquity + totalDebt) : null;
  const capmCostOfEquity = deriveCapmCostOfEquity(inputs);
  const costOfEquity =
    inputs.cost_of_equity_method === "capm"
      ? capmCostOfEquity
      : finite(inputs.cost_of_equity)
        ? round4(inputs.cost_of_equity!)
        : null;
  const taxRate = finite(inputs.corporate_tax_rate) ? inputs.corporate_tax_rate! : null;
  const costOfDebt = finite(inputs.cost_of_debt) ? inputs.cost_of_debt! : null;
  const equityWeight =
    totalCapital != null && totalCapital > 0 && marketValueEquity != null
      ? round4(marketValueEquity / totalCapital)
      : null;
  const debtWeight =
    totalCapital != null && totalCapital > 0 && totalDebt != null ? round4(totalDebt / totalCapital) : null;
  const afterTaxCostOfDebt =
    costOfDebt != null && taxRate != null ? round4(costOfDebt * (1 - taxRate)) : null;
  const equityComponent =
    equityWeight != null && costOfEquity != null ? round4(equityWeight * costOfEquity) : null;
  const debtComponent =
    debtWeight != null && afterTaxCostOfDebt != null ? round4(debtWeight * afterTaxCostOfDebt) : null;
  const wacc =
    equityComponent != null && debtComponent != null ? round4(equityComponent + debtComponent) : null;

  return {
    ok: errors.length === 0 && wacc != null,
    errors,
    market_value_equity: marketValueEquity,
    total_debt: totalDebt,
    total_capital: totalCapital,
    equity_weight: equityWeight,
    debt_weight: debtWeight,
    cost_of_equity: costOfEquity,
    after_tax_cost_of_debt: afterTaxCostOfDebt,
    capm_cost_of_equity: capmCostOfEquity,
    wacc,
    breakdown: {
      equity_component: equityComponent,
      debt_component: debtComponent,
    },
  };
}

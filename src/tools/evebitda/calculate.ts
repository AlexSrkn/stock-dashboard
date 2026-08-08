import {
  calculateNetDebt,
  equityValueFromEnterpriseValue,
  sharePriceFromEquityValue,
} from "../ev/calculate.js";
import type {
  EvEbitdaCalculateInputs,
  EvEbitdaCalculateResult,
  EvEbitdaScenarioId,
  EvEbitdaScenarioResult,
} from "./types.js";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Implied Enterprise Value = EBITDA × EV/EBITDA multiple. */
export function impliedEnterpriseValueFromEbitda(
  ebitda: number,
  multiple: number
): number | null {
  if (!Number.isFinite(ebitda) || !Number.isFinite(multiple) || multiple <= 0) return null;
  const ev = roundMoney(ebitda * multiple);
  return Number.isFinite(ev) ? ev : null;
}

export function validateEvEbitdaInputs(inputs: EvEbitdaCalculateInputs): string[] {
  const errors: string[] = [];

  if (!finite(inputs.ebitda)) {
    errors.push("EBITDA is required (enter manually if not available from filings).");
  } else if (inputs.ebitda === 0) {
    errors.push("EBITDA is zero — implied enterprise value cannot be valued via EV/EBITDA.");
  }

  if (!finite(inputs.target_multiple) || inputs.target_multiple! <= 0) {
    errors.push("Target EV/EBITDA multiple must be greater than zero.");
  }

  if (!finite(inputs.total_debt)) {
    errors.push("Total debt is required (enter manually if not available from filings).");
  } else if (inputs.total_debt! < 0) {
    errors.push("Total debt must be zero or greater.");
  }

  if (!finite(inputs.cash)) {
    errors.push("Cash is required (enter manually if not available from filings).");
  } else if (inputs.cash! < 0) {
    errors.push("Cash must be zero or greater.");
  }

  if (!finite(inputs.shares_outstanding) || inputs.shares_outstanding! <= 0) {
    errors.push("Diluted shares outstanding must be greater than zero.");
  }

  if (finite(inputs.current_share_price) && inputs.current_share_price! < 0) {
    errors.push("Current share price must be zero or greater.");
  }

  return errors;
}

function valueAtMultiple(
  inputs: EvEbitdaCalculateInputs,
  ebitda: number,
  multiple: number
): {
  implied_enterprise_value: number | null;
  implied_equity_value: number | null;
  implied_share_price: number | null;
} {
  const enterprise = impliedEnterpriseValueFromEbitda(ebitda, multiple);
  const equity = equityValueFromEnterpriseValue(enterprise, inputs.total_debt, inputs.cash);
  const sharePrice = sharePriceFromEquityValue(equity, inputs.shares_outstanding);
  return {
    implied_enterprise_value: enterprise,
    implied_equity_value: equity,
    implied_share_price: sharePrice,
  };
}

const DEFAULT_SCENARIOS: Record<
  EvEbitdaScenarioId,
  { ev_ebitda_multiple: number; label: string }
> = {
  bear: { ev_ebitda_multiple: 12, label: "Bear Case" },
  base: { ev_ebitda_multiple: 15, label: "Base Case" },
  bull: { ev_ebitda_multiple: 18, label: "Bull Case" },
};

export function calculateEvEbitdaValuation(
  inputs: EvEbitdaCalculateInputs
): EvEbitdaCalculateResult {
  const errors = validateEvEbitdaInputs(inputs);
  const ebitda = finite(inputs.ebitda) ? inputs.ebitda! : null;
  const targetMultiple = finite(inputs.target_multiple) ? inputs.target_multiple! : null;
  const currentPrice = finite(inputs.current_share_price) ? inputs.current_share_price! : null;
  const netDebt = calculateNetDebt(inputs.total_debt, inputs.cash);

  if (errors.length || ebitda == null || targetMultiple == null || ebitda === 0) {
    return {
      ok: false,
      errors: errors.length
        ? errors
        : ["Unable to calculate EV/EBITDA valuation with the current inputs."],
      ebitda,
      target_multiple: targetMultiple,
      implied_enterprise_value: null,
      implied_equity_value: null,
      implied_share_price: null,
      current_share_price: currentPrice,
      implied_upside: null,
      net_debt: netDebt,
      scenarios: [],
      bridge: {
        ebitda,
        target_multiple: targetMultiple,
        implied_enterprise_value: null,
        total_debt: finite(inputs.total_debt) ? inputs.total_debt! : null,
        cash: finite(inputs.cash) ? inputs.cash! : null,
        implied_equity_value: null,
        shares_outstanding: finite(inputs.shares_outstanding) ? inputs.shares_outstanding! : null,
        implied_share_price: null,
      },
    };
  }

  const core = valueAtMultiple(inputs, ebitda, targetMultiple);
  const upside =
    core.implied_share_price != null && currentPrice != null && currentPrice > 0
      ? round4(core.implied_share_price / currentPrice - 1)
      : null;

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

  const scenarios: EvEbitdaScenarioResult[] = (
    ["bear", "base", "bull"] as EvEbitdaScenarioId[]
  ).map((id) => {
    const def = scenarioDefs[id];
    if (!finite(def.ev_ebitda_multiple) || def.ev_ebitda_multiple <= 0) {
      return {
        id,
        label: def.label,
        ev_ebitda_multiple: def.ev_ebitda_multiple,
        implied_enterprise_value: null,
        implied_equity_value: null,
        implied_share_price: null,
        error: "EV/EBITDA multiple must be greater than zero.",
      };
    }
    const trial = valueAtMultiple(inputs, ebitda, def.ev_ebitda_multiple);
    return {
      id,
      label: def.label,
      ev_ebitda_multiple: def.ev_ebitda_multiple,
      implied_enterprise_value: trial.implied_enterprise_value,
      implied_equity_value: trial.implied_equity_value,
      implied_share_price: trial.implied_share_price,
      error: null,
    };
  });

  const ok =
    core.implied_enterprise_value != null &&
    core.implied_equity_value != null &&
    core.implied_share_price != null &&
    Number.isFinite(core.implied_share_price);

  return {
    ok,
    errors: ok ? [] : ["Implied share price could not be calculated."],
    ebitda,
    target_multiple: targetMultiple,
    implied_enterprise_value: ok ? core.implied_enterprise_value : null,
    implied_equity_value: ok ? core.implied_equity_value : null,
    implied_share_price: ok ? core.implied_share_price : null,
    current_share_price: currentPrice,
    implied_upside: upside,
    net_debt: netDebt,
    scenarios,
    bridge: {
      ebitda,
      target_multiple: targetMultiple,
      implied_enterprise_value: ok ? core.implied_enterprise_value : null,
      total_debt: inputs.total_debt,
      cash: inputs.cash,
      implied_equity_value: ok ? core.implied_equity_value : null,
      shares_outstanding: inputs.shares_outstanding,
      implied_share_price: ok ? core.implied_share_price : null,
    },
  };
}

import type {
  PeCalculateInputs,
  PeCalculateResult,
  PeScenarioId,
  PeScenarioResult,
} from "./types.js";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function roundShare(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Resolve EPS: prefer reported diluted EPS; otherwise derive from net income / diluted shares.
 */
export function resolveEps(inputs: {
  diluted_eps: number | null;
  net_income: number | null;
  shares_outstanding: number | null;
}): { eps: number | null; source: "reported" | "derived" | null } {
  if (finite(inputs.diluted_eps)) {
    return { eps: round4(inputs.diluted_eps), source: "reported" };
  }
  if (
    finite(inputs.net_income) &&
    finite(inputs.shares_outstanding) &&
    inputs.shares_outstanding! > 0
  ) {
    return {
      eps: round4(inputs.net_income! / inputs.shares_outstanding!),
      source: "derived",
    };
  }
  return { eps: null, source: null };
}

export function impliedSharePrice(eps: number, peMultiple: number): number | null {
  if (!Number.isFinite(eps) || !Number.isFinite(peMultiple) || peMultiple <= 0) return null;
  const price = eps * peMultiple;
  return Number.isFinite(price) ? roundShare(price) : null;
}

export function validatePeInputs(inputs: PeCalculateInputs): string[] {
  const errors: string[] = [];
  const { eps } = resolveEps(inputs);

  if (eps == null) {
    errors.push("Diluted EPS is required (or provide net income and diluted shares).");
  } else if (eps === 0) {
    errors.push("EPS is zero — implied share price cannot be valued via P/E.");
  }

  if (!finite(inputs.target_pe) || inputs.target_pe! <= 0) {
    errors.push("Target P/E multiple must be greater than zero.");
  }

  if (finite(inputs.shares_outstanding) && inputs.shares_outstanding! <= 0) {
    errors.push("Diluted shares outstanding must be greater than zero.");
  }

  if (finite(inputs.current_share_price) && inputs.current_share_price! < 0) {
    errors.push("Current share price must be zero or greater.");
  }

  return errors;
}

const DEFAULT_SCENARIOS: Record<
  PeScenarioId,
  { pe_multiple: number; label: string }
> = {
  bear: { pe_multiple: 15, label: "Bear Case" },
  base: { pe_multiple: 20, label: "Base Case" },
  bull: { pe_multiple: 25, label: "Bull Case" },
};

export function calculatePeValuation(inputs: PeCalculateInputs): PeCalculateResult {
  const { eps, source } = resolveEps(inputs);
  const errors = validatePeInputs(inputs);
  const targetPe = finite(inputs.target_pe) ? inputs.target_pe! : null;
  const currentPrice = finite(inputs.current_share_price) ? inputs.current_share_price! : null;

  if (errors.length || eps == null || targetPe == null || eps === 0) {
    return {
      ok: false,
      errors: errors.length
        ? errors
        : ["Unable to calculate P/E valuation with the current inputs."],
      diluted_eps: eps,
      eps_source: source,
      target_pe: targetPe,
      implied_share_price: null,
      current_share_price: currentPrice,
      implied_upside: null,
      scenarios: [],
      bridge: {
        diluted_eps: eps,
        target_pe: targetPe,
        implied_share_price: null,
      },
    };
  }

  const implied = impliedSharePrice(eps, targetPe);
  const upside =
    implied != null && currentPrice != null && currentPrice > 0
      ? round4(implied / currentPrice - 1)
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

  const scenarios: PeScenarioResult[] = (["bear", "base", "bull"] as PeScenarioId[]).map(
    (id) => {
      const def = scenarioDefs[id];
      if (!finite(def.pe_multiple) || def.pe_multiple <= 0) {
        return {
          id,
          label: def.label,
          pe_multiple: def.pe_multiple,
          implied_share_price: null,
          error: "P/E multiple must be greater than zero.",
        };
      }
      return {
        id,
        label: def.label,
        pe_multiple: def.pe_multiple,
        implied_share_price: impliedSharePrice(eps, def.pe_multiple),
        error: null,
      };
    }
  );

  const ok = implied != null && Number.isFinite(implied);

  return {
    ok,
    errors: ok ? [] : ["Implied share price could not be calculated."],
    diluted_eps: eps,
    eps_source: source,
    target_pe: targetPe,
    implied_share_price: ok ? implied : null,
    current_share_price: currentPrice,
    implied_upside: upside,
    scenarios,
    bridge: {
      diluted_eps: eps,
      target_pe: targetPe,
      implied_share_price: ok ? implied : null,
    },
  };
}

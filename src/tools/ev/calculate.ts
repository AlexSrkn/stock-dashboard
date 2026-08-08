import type { EvCalculateInputs, EvCalculateResult } from "./types.js";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve market capitalization from either price × shares or a direct market-cap input.
 * Prefer price × shares when both are available and mode is not forced to manual.
 */
export function resolveMarketCap(inputs: EvCalculateInputs): {
  market_cap: number | null;
  source: "price_times_shares" | "manual" | null;
  errors: string[];
} {
  const errors: string[] = [];
  const mode = inputs.market_cap_mode ?? "derived";
  const hasPrice = finite(inputs.current_share_price);
  const hasShares = finite(inputs.shares_outstanding);
  const hasManualCap = finite(inputs.market_cap);

  if (mode === "manual") {
    if (!hasManualCap) {
      errors.push("Market capitalization is required when entering it directly.");
      return { market_cap: null, source: null, errors };
    }
    if (inputs.market_cap! < 0) {
      errors.push("Market capitalization must be zero or greater.");
      return { market_cap: null, source: null, errors };
    }
    return { market_cap: roundMoney(inputs.market_cap!), source: "manual", errors: [] };
  }

  if (hasPrice && hasShares) {
    if (inputs.current_share_price! < 0) {
      errors.push("Share price must be zero or greater.");
    }
    if (inputs.shares_outstanding! <= 0) {
      errors.push("Shares outstanding must be greater than zero.");
    }
    if (errors.length) return { market_cap: null, source: null, errors };
    return {
      market_cap: roundMoney(inputs.current_share_price! * inputs.shares_outstanding!),
      source: "price_times_shares",
      errors: [],
    };
  }

  if (hasManualCap) {
    if (inputs.market_cap! < 0) {
      errors.push("Market capitalization must be zero or greater.");
      return { market_cap: null, source: null, errors };
    }
    return { market_cap: roundMoney(inputs.market_cap!), source: "manual", errors: [] };
  }

  if (!hasPrice) errors.push("Share price is required (or enter market cap directly).");
  if (!hasShares) errors.push("Shares outstanding are required (or enter market cap directly).");
  return { market_cap: null, source: null, errors };
}

export function validateEvInputs(inputs: EvCalculateInputs): string[] {
  const errors: string[] = [];
  const resolved = resolveMarketCap(inputs);
  errors.push(...resolved.errors);

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

  return errors;
}

/**
 * Enterprise Value = Market Cap + Total Debt − Cash & Cash Equivalents.
 * Reusable by EV/EBITDA and other valuation tools.
 */
export function calculateEnterpriseValue(inputs: EvCalculateInputs): EvCalculateResult {
  const resolved = resolveMarketCap(inputs);
  const errors = validateEvInputs(inputs);
  const marketCap = resolved.market_cap;
  const debt = finite(inputs.total_debt) ? inputs.total_debt! : null;
  const cash = finite(inputs.cash) ? inputs.cash! : null;
  const netDebt =
    debt != null && cash != null ? roundMoney(debt - cash) : null;
  const enterpriseValue =
    marketCap != null && debt != null && cash != null
      ? roundMoney(marketCap + debt - cash)
      : null;

  const ok =
    errors.length === 0 &&
    enterpriseValue != null &&
    Number.isFinite(enterpriseValue);

  return {
    ok,
    errors: ok ? [] : errors.length ? errors : ["Unable to calculate Enterprise Value with the current inputs."],
    current_share_price: finite(inputs.current_share_price) ? inputs.current_share_price! : null,
    shares_outstanding: finite(inputs.shares_outstanding) ? inputs.shares_outstanding! : null,
    market_cap: marketCap,
    market_cap_source: resolved.source,
    total_debt: debt,
    cash,
    net_debt: netDebt,
    enterprise_value: ok ? enterpriseValue : null,
    bridge: {
      market_cap: marketCap,
      total_debt: debt,
      cash,
      enterprise_value: ok ? enterpriseValue : null,
    },
  };
}

/** Net Debt = Total Debt − Cash (negative means net cash). */
export function calculateNetDebt(totalDebt: number | null, cash: number | null): number | null {
  if (!finite(totalDebt) || !finite(cash)) return null;
  return roundMoney(totalDebt - cash);
}

/**
 * Equity Value = Enterprise Value − Debt + Cash (= EV − Net Debt).
 * Shared by EV/EBITDA and related valuation tools.
 */
export function equityValueFromEnterpriseValue(
  enterpriseValue: number | null,
  totalDebt: number | null,
  cash: number | null
): number | null {
  if (!finite(enterpriseValue) || !finite(totalDebt) || !finite(cash)) return null;
  const equity = roundMoney(enterpriseValue - totalDebt + cash);
  return Number.isFinite(equity) ? equity : null;
}

/** Implied share price from equity value ÷ diluted shares. */
export function sharePriceFromEquityValue(
  equityValue: number | null,
  sharesOutstanding: number | null
): number | null {
  if (!finite(equityValue) || !finite(sharesOutstanding) || sharesOutstanding <= 0) return null;
  const price = Math.round((equityValue / sharesOutstanding) * 100) / 100;
  return Number.isFinite(price) ? price : null;
}

import type { DcfSourceRef } from "../dcf/types.js";

export interface FcfYieldFinancialInputs {
  operating_cash_flow: number | null;
  capital_expenditures: number | null;
  free_cash_flow: number | null;
  current_share_price: number | null;
  shares_outstanding: number | null;
  market_cap: number | null;
  total_debt: number | null;
  cash: number | null;
  enterprise_value: number | null;
}

export interface FcfYieldInputsResponse {
  ticker: string;
  company_name: string;
  cik: string | null;
  financials: FcfYieldFinancialInputs;
  sources: Partial<Record<keyof FcfYieldFinancialInputs, DcfSourceRef>>;
  missing: string[];
  methodology: string;
}

export interface FcfYieldCalculateInputs {
  operating_cash_flow: number | null;
  capital_expenditures: number | null;
  free_cash_flow: number | null;
  /** When "manual", use free_cash_flow directly; otherwise prefer OCF − CapEx. */
  fcf_mode?: "derived" | "manual";
  current_share_price: number | null;
  shares_outstanding: number | null;
  market_cap: number | null;
  total_debt: number | null;
  cash: number | null;
  enterprise_value: number | null;
  /** When "manual", use enterprise_value directly when provided. */
  enterprise_value_mode?: "derived" | "manual";
}

export interface FcfYieldCalculateResult {
  ok: boolean;
  errors: string[];
  operating_cash_flow: number | null;
  capital_expenditures: number | null;
  free_cash_flow: number | null;
  market_cap: number | null;
  enterprise_value: number | null;
  /** Decimal ratio (e.g. 0.05 = 5%). */
  fcf_yield: number | null;
  /** Decimal ratio (e.g. 0.04 = 4%). */
  fcf_yield_on_ev: number | null;
  bridge: {
    operating_cash_flow: number | null;
    capital_expenditures: number | null;
    free_cash_flow: number | null;
    market_cap: number | null;
    fcf_yield: number | null;
    enterprise_value: number | null;
    fcf_yield_on_ev: number | null;
  };
}

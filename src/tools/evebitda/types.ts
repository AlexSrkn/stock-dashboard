import type { DcfSourceRef } from "../dcf/types.js";

export type EvEbitdaScenarioId = "bear" | "base" | "bull";

export interface EvEbitdaFinancialInputs {
  ebitda: number | null;
  total_debt: number | null;
  cash: number | null;
  shares_outstanding: number | null;
  current_share_price: number | null;
}

export interface EvEbitdaInputsResponse {
  ticker: string;
  company_name: string;
  cik: string | null;
  financials: EvEbitdaFinancialInputs;
  sources: Partial<Record<keyof EvEbitdaFinancialInputs, DcfSourceRef>>;
  missing: string[];
  methodology: string;
}

export interface EvEbitdaScenarioAssumptions {
  ev_ebitda_multiple: number;
}

export interface EvEbitdaCalculateInputs {
  ebitda: number | null;
  total_debt: number | null;
  cash: number | null;
  shares_outstanding: number | null;
  current_share_price: number | null;
  target_multiple: number | null;
  scenarios?: Partial<Record<EvEbitdaScenarioId, EvEbitdaScenarioAssumptions>>;
}

export interface EvEbitdaScenarioResult {
  id: EvEbitdaScenarioId;
  label: string;
  ev_ebitda_multiple: number;
  implied_enterprise_value: number | null;
  implied_equity_value: number | null;
  implied_share_price: number | null;
  error: string | null;
}

export interface EvEbitdaCalculateResult {
  ok: boolean;
  errors: string[];
  ebitda: number | null;
  target_multiple: number | null;
  implied_enterprise_value: number | null;
  implied_equity_value: number | null;
  implied_share_price: number | null;
  current_share_price: number | null;
  implied_upside: number | null;
  net_debt: number | null;
  scenarios: EvEbitdaScenarioResult[];
  bridge: {
    ebitda: number | null;
    target_multiple: number | null;
    implied_enterprise_value: number | null;
    total_debt: number | null;
    cash: number | null;
    implied_equity_value: number | null;
    shares_outstanding: number | null;
    implied_share_price: number | null;
  };
}

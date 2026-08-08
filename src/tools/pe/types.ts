import type { DcfSourceRef } from "../dcf/types.js";

export type PeScenarioId = "bear" | "base" | "bull";

export interface PeFinancialInputs {
  diluted_eps: number | null;
  net_income: number | null;
  shares_outstanding: number | null;
  current_share_price: number | null;
  /** EPS derived from net income / diluted shares when reported EPS is missing. */
  derived_eps: number | null;
}

export interface PeInputsResponse {
  ticker: string;
  company_name: string;
  cik: string | null;
  financials: PeFinancialInputs;
  sources: Partial<Record<keyof PeFinancialInputs, DcfSourceRef>>;
  missing: string[];
  methodology: string;
}

export interface PeScenarioAssumptions {
  pe_multiple: number;
}

export interface PeCalculateInputs {
  diluted_eps: number | null;
  net_income: number | null;
  shares_outstanding: number | null;
  current_share_price: number | null;
  target_pe: number | null;
  scenarios?: Partial<Record<PeScenarioId, PeScenarioAssumptions>>;
}

export interface PeScenarioResult {
  id: PeScenarioId;
  label: string;
  pe_multiple: number;
  implied_share_price: number | null;
  error: string | null;
}

export interface PeCalculateResult {
  ok: boolean;
  errors: string[];
  diluted_eps: number | null;
  eps_source: "reported" | "derived" | null;
  target_pe: number | null;
  implied_share_price: number | null;
  current_share_price: number | null;
  implied_upside: number | null;
  scenarios: PeScenarioResult[];
  bridge: {
    diluted_eps: number | null;
    target_pe: number | null;
    implied_share_price: number | null;
  };
}

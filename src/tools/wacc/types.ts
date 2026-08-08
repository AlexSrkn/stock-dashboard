import type { DcfSourceRef } from "../dcf/types.js";

export type CostOfEquityMethod = "capm" | "manual";

export interface WaccFinancialInputs {
  market_value_equity: number | null;
  total_debt: number | null;
  cost_of_equity: number | null;
  cost_of_debt: number | null;
  corporate_tax_rate: number | null;
  current_share_price: number | null;
  shares_outstanding: number | null;
  beta: number | null;
  risk_free_rate: number | null;
  equity_risk_premium: number | null;
}

export interface WaccInputsResponse {
  ticker: string;
  company_name: string;
  cik: string | null;
  financials: WaccFinancialInputs;
  sources: Partial<Record<keyof WaccFinancialInputs, DcfSourceRef>>;
  missing: string[];
  explanation: string;
}

export interface WaccCalculateInputs {
  market_value_equity: number | null;
  total_debt: number | null;
  cost_of_equity_method: CostOfEquityMethod;
  cost_of_equity: number | null;
  cost_of_debt: number | null;
  corporate_tax_rate: number | null;
  risk_free_rate: number | null;
  beta: number | null;
  equity_risk_premium: number | null;
}

export interface WaccCalculateResult {
  ok: boolean;
  errors: string[];
  market_value_equity: number | null;
  total_debt: number | null;
  total_capital: number | null;
  equity_weight: number | null;
  debt_weight: number | null;
  cost_of_equity: number | null;
  after_tax_cost_of_debt: number | null;
  capm_cost_of_equity: number | null;
  wacc: number | null;
  breakdown: {
    equity_component: number | null;
    debt_component: number | null;
  };
}

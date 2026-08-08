import type { DcfSourceRef } from "../dcf/types.js";

export type EpvNormalizationMethod = "current_ebit" | "average_ebit" | "normalized_margin";
export type EpvScenarioId = "bear" | "base" | "bull";

export interface EpvHistoricalMargin {
  fiscal_year: number | null;
  fiscal_period: string | null;
  end: string | null;
  revenue: number | null;
  ebit: number | null;
  operating_margin: number | null;
  filing_type: string | null;
  filing_date: string | null;
}

export interface EpvFinancialInputs {
  revenue: number | null;
  ebit: number | null;
  tax_rate: number | null;
  depreciation: number | null;
  cash: number | null;
  debt: number | null;
  shares_outstanding: number | null;
  current_share_price: number | null;
  average_ebit: number | null;
  suggested_normalized_margin: number | null;
}

export interface EpvInputsResponse {
  ticker: string;
  company_name: string;
  cik: string | null;
  financials: EpvFinancialInputs;
  historical_margins: EpvHistoricalMargin[];
  sources: Partial<Record<keyof EpvFinancialInputs, DcfSourceRef>>;
  missing: string[];
  methodology: string;
}

export interface EpvScenarioAssumptions {
  normalized_margin: number;
  wacc: number;
}

export interface EpvCalculateInputs {
  revenue: number | null;
  ebit: number | null;
  average_ebit: number | null;
  tax_rate: number | null;
  cash: number | null;
  debt: number | null;
  shares_outstanding: number | null;
  current_share_price: number | null;
  normalization_method: EpvNormalizationMethod;
  normalized_margin: number | null;
  wacc: number | null;
  sensitivity_wacc?: number[];
  sensitivity_margins?: number[];
  scenarios?: Partial<Record<EpvScenarioId, EpvScenarioAssumptions>>;
}

export interface EpvSensitivityCell {
  wacc: number;
  normalized_margin: number;
  epv_per_share: number | null;
  valid: boolean;
}

export interface EpvScenarioResult {
  id: EpvScenarioId;
  label: string;
  normalized_margin: number;
  wacc: number;
  epv_per_share: number | null;
  error: string | null;
}

export interface EpvCalculateResult {
  ok: boolean;
  errors: string[];
  normalization_method: EpvNormalizationMethod;
  normalized_ebit: number | null;
  tax: number | null;
  normalized_after_tax_earnings: number | null;
  wacc: number | null;
  enterprise_epv: number | null;
  equity_epv: number | null;
  epv_per_share: number | null;
  implied_upside: number | null;
  sensitivity_matrix: EpvSensitivityCell[];
  scenarios: EpvScenarioResult[];
  epv_range: { low: number | null; high: number | null } | null;
  bridge: {
    normalized_ebit: number | null;
    tax: number | null;
    normalized_after_tax_earnings: number | null;
    wacc: number | null;
    enterprise_epv: number | null;
    debt: number | null;
    cash: number | null;
    equity_epv: number | null;
    shares_outstanding: number | null;
    epv_per_share: number | null;
  };
}

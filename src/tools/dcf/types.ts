/** Shared types for the DCF calculator. */

export type ForecastYears = 5 | 7 | 10;
export type GrowthMethod = "fcf_growth" | "revenue_margin";
export type TerminalMethod = "perpetual_growth" | "exit_multiple";
export type ScenarioId = "bear" | "base" | "bull";

export interface DcfSourceRef {
  filing_type: string | null;
  filing_date: string | null;
  fiscal_period: string | null;
  fiscal_year: number | null;
  end: string | null;
  accession: string | null;
  note?: string | null;
}

export interface DcfFinancialInputs {
  revenue: number | null;
  ebit: number | null;
  tax_rate: number | null;
  depreciation: number | null;
  capex: number | null;
  change_in_working_capital: number | null;
  cash: number | null;
  debt: number | null;
  shares_outstanding: number | null;
  /** Not populated from SEC — user enters manually. */
  current_share_price: number | null;
  ebitda: number | null;
}

export interface DcfFilingInputsResponse {
  ticker: string;
  company_name: string;
  cik: string | null;
  financials: DcfFinancialInputs;
  sources: Partial<Record<keyof DcfFinancialInputs, DcfSourceRef>>;
  fcf_components: {
    ebit: number | null;
    tax: number | null;
    nopat: number | null;
    depreciation: number | null;
    capex: number | null;
    change_in_working_capital: number | null;
    fcf: number | null;
  };
  missing: string[];
  disclaimer: string;
}

export interface DcfCalculateInputs {
  revenue: number | null;
  ebit: number | null;
  tax_rate: number | null;
  depreciation: number | null;
  capex: number | null;
  change_in_working_capital: number | null;
  cash: number | null;
  debt: number | null;
  shares_outstanding: number | null;
  current_share_price: number | null;
  ebitda: number | null;

  forecast_years: ForecastYears;
  growth_method: GrowthMethod;
  /** Per-year FCF growth rates (decimal, e.g. 0.10). Length = forecast_years when fcf_growth. */
  fcf_growth_rates: number[];
  /** Per-year revenue growth rates when revenue_margin. */
  revenue_growth_rates: number[];
  fcf_margin_current: number | null;
  fcf_margin_terminal: number | null;

  wacc: number;
  terminal_method: TerminalMethod;
  terminal_growth: number;
  exit_ebitda_multiple: number;

  /** Optional sensitivity axes (decimals). */
  sensitivity_wacc?: number[];
  sensitivity_terminal_growth?: number[];

  scenarios?: Partial<
    Record<
      ScenarioId,
      {
        fcf_growth: number;
        wacc: number;
        terminal_growth: number;
      }
    >
  >;
}

export interface DcfYearProjection {
  year: number;
  revenue: number | null;
  ebit: number | null;
  tax: number | null;
  depreciation: number | null;
  capex: number | null;
  change_in_working_capital: number | null;
  fcf: number;
  discount_factor: number;
  present_value: number;
}

export interface DcfSensitivityCell {
  wacc: number;
  terminal_growth: number;
  intrinsic_value_per_share: number | null;
  valid: boolean;
}

export interface DcfScenarioResult {
  id: ScenarioId;
  label: string;
  fcf_growth: number;
  wacc: number;
  terminal_growth: number;
  intrinsic_value_per_share: number | null;
  error: string | null;
}

export interface DcfCalculateResult {
  ok: boolean;
  errors: string[];
  base_fcf: number | null;
  fcf_components: {
    ebit: number | null;
    tax: number | null;
    nopat: number | null;
    depreciation: number | null;
    capex: number | null;
    change_in_working_capital: number | null;
    fcf: number | null;
  };
  projected_fcf: DcfYearProjection[];
  terminal_value: number | null;
  pv_forecast_fcf: number | null;
  pv_terminal_value: number | null;
  enterprise_value: number | null;
  equity_value: number | null;
  intrinsic_value_per_share: number | null;
  implied_upside: number | null;
  terminal_value_percentage: number | null;
  sensitivity_matrix: DcfSensitivityCell[];
  scenarios: DcfScenarioResult[];
  reverse_dcf: {
    available: boolean;
    implied_fcf_growth: number | null;
    message: string | null;
  };
  dcf_range: { low: number | null; high: number | null } | null;
}

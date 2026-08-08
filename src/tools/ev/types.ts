import type { DcfSourceRef } from "../dcf/types.js";

export interface EvFinancialInputs {
  current_share_price: number | null;
  shares_outstanding: number | null;
  market_cap: number | null;
  total_debt: number | null;
  cash: number | null;
}

export interface EvInputsResponse {
  ticker: string;
  company_name: string;
  cik: string | null;
  financials: EvFinancialInputs;
  sources: Partial<Record<keyof EvFinancialInputs, DcfSourceRef>>;
  missing: string[];
  methodology: string;
}

export type EvMarketCapMode = "derived" | "manual";

export interface EvCalculateInputs {
  current_share_price: number | null;
  shares_outstanding: number | null;
  market_cap: number | null;
  /** When "manual", use market_cap directly; otherwise prefer price × shares when both available. */
  market_cap_mode?: EvMarketCapMode;
  total_debt: number | null;
  cash: number | null;
}

export interface EvCalculateResult {
  ok: boolean;
  errors: string[];
  current_share_price: number | null;
  shares_outstanding: number | null;
  market_cap: number | null;
  market_cap_source: "price_times_shares" | "manual" | null;
  total_debt: number | null;
  cash: number | null;
  net_debt: number | null;
  enterprise_value: number | null;
  bridge: {
    market_cap: number | null;
    total_debt: number | null;
    cash: number | null;
    enterprise_value: number | null;
  };
}

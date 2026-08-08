import { fetchStockPrice } from "../../market/stockPrice.js";
import type { FilingsFundamentalsResponse } from "../../sec/financials/types.js";
import { mapFilingsToDcfInputs } from "../dcf/filingInputs.js";
import type { EvEbitdaFinancialInputs, EvEbitdaInputsResponse } from "./types.js";

const METHODOLOGY =
  "EV/EBITDA valuation estimates enterprise value by applying a selected multiple to EBITDA, then adjusts for debt and cash to derive equity value.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export async function mapFilingsToEvEbitdaInputs(
  data: FilingsFundamentalsResponse
): Promise<EvEbitdaInputsResponse> {
  const dcf = mapFilingsToDcfInputs(data);
  const quote = await fetchStockPrice(data.ticker);
  const currentSharePrice = finite(quote.price) ? quote.price : null;

  const financials: EvEbitdaFinancialInputs = {
    ebitda: dcf.financials.ebitda,
    total_debt: dcf.financials.debt,
    cash: dcf.financials.cash,
    shares_outstanding: dcf.financials.shares_outstanding,
    current_share_price: currentSharePrice,
  };

  const sources: EvEbitdaInputsResponse["sources"] = {};
  if (financials.ebitda != null && dcf.sources.ebitda) {
    sources.ebitda = dcf.sources.ebitda;
  }
  if (financials.total_debt != null && dcf.sources.debt) {
    sources.total_debt = dcf.sources.debt;
  }
  if (financials.cash != null && dcf.sources.cash) {
    sources.cash = dcf.sources.cash;
  }
  if (financials.shares_outstanding != null && dcf.sources.shares_outstanding) {
    sources.shares_outstanding = dcf.sources.shares_outstanding;
  }
  if (financials.current_share_price != null) {
    sources.current_share_price = {
      filing_type: null,
      filing_date: null,
      fiscal_period: null,
      fiscal_year: null,
      end: null,
      accession: null,
      note: `Market quote (${quote.currency || "USD"})`,
    };
  }

  const missing: string[] = [];
  if (financials.ebitda == null) missing.push("EBITDA");
  if (financials.total_debt == null) missing.push("Total Debt");
  if (financials.cash == null) missing.push("Cash");
  if (financials.shares_outstanding == null) missing.push("Diluted Shares Outstanding");
  if (financials.current_share_price == null) missing.push("Current Share Price");

  return {
    ticker: data.ticker,
    company_name: data.entityName || data.ticker,
    cik: data.cik || null,
    financials,
    sources,
    missing,
    methodology: METHODOLOGY,
  };
}

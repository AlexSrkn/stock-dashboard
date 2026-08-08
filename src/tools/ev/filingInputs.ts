import { fetchStockPrice } from "../../market/stockPrice.js";
import type { FilingsFundamentalsResponse } from "../../sec/financials/types.js";
import { mapFilingsToDcfInputs } from "../dcf/filingInputs.js";
import type { EvFinancialInputs, EvInputsResponse } from "./types.js";

const METHODOLOGY =
  "Enterprise Value represents the value of the operating business, taking both debt and cash into account.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export async function mapFilingsToEvInputs(
  data: FilingsFundamentalsResponse
): Promise<EvInputsResponse> {
  const dcf = mapFilingsToDcfInputs(data);
  const sharesOutstanding = dcf.financials.shares_outstanding;
  const totalDebt = dcf.financials.debt;
  const cash = dcf.financials.cash;

  const quote = await fetchStockPrice(data.ticker);
  const currentSharePrice = finite(quote.price) ? quote.price : null;
  const marketCap =
    currentSharePrice != null && sharesOutstanding != null && sharesOutstanding > 0
      ? Math.round(currentSharePrice * sharesOutstanding * 100) / 100
      : null;

  const financials: EvFinancialInputs = {
    current_share_price: currentSharePrice,
    shares_outstanding: sharesOutstanding,
    market_cap: marketCap,
    total_debt: totalDebt,
    cash,
  };

  const sources: EvInputsResponse["sources"] = {};
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
  if (financials.shares_outstanding != null && dcf.sources.shares_outstanding) {
    sources.shares_outstanding = dcf.sources.shares_outstanding;
  }
  if (financials.market_cap != null) {
    sources.market_cap = {
      filing_type: dcf.sources.shares_outstanding?.filing_type ?? null,
      filing_date: dcf.sources.shares_outstanding?.filing_date ?? null,
      fiscal_period: dcf.sources.shares_outstanding?.fiscal_period ?? null,
      fiscal_year: dcf.sources.shares_outstanding?.fiscal_year ?? null,
      end: dcf.sources.shares_outstanding?.end ?? null,
      accession: dcf.sources.shares_outstanding?.accession ?? null,
      note: `Derived from market quote (${quote.currency || "USD"}) × SEC shares outstanding`,
    };
  }
  if (financials.total_debt != null && dcf.sources.debt) {
    sources.total_debt = dcf.sources.debt;
  }
  if (financials.cash != null && dcf.sources.cash) {
    sources.cash = dcf.sources.cash;
  }

  const missing: string[] = [];
  if (financials.current_share_price == null) missing.push("Share Price");
  if (financials.shares_outstanding == null) missing.push("Shares Outstanding");
  if (financials.market_cap == null) missing.push("Market Capitalization");
  if (financials.total_debt == null) missing.push("Total Debt");
  if (financials.cash == null) missing.push("Cash & Cash Equivalents");

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

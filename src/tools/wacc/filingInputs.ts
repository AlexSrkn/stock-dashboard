import { fetchStockPrice } from "../../market/stockPrice.js";
import type { FilingsFundamentalsResponse } from "../../sec/financials/types.js";
import {
  buildLatestAnnualFilingRows,
  deriveTaxRate,
  mapFilingsToDcfInputs,
  periodLabel,
  sourceFromRow,
} from "../dcf/filingInputs.js";
import type { WaccInputsResponse, WaccFinancialInputs } from "./types.js";

const EXPLANATION =
  "WACC (Weighted Average Cost of Capital) estimates the average return required by a company's shareholders and lenders. In a DCF, it is used as the discount rate for future cash flows.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function deriveCostOfDebt(interestExpense: number | null, totalDebt: number | null): number | null {
  if (!finite(interestExpense) || !finite(totalDebt) || totalDebt <= 0) return null;
  const rate = Math.abs(interestExpense) / totalDebt;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  return Math.round(rate * 10000) / 10000;
}

export async function mapFilingsToWaccInputs(
  data: FilingsFundamentalsResponse
): Promise<WaccInputsResponse> {
  const dcf = mapFilingsToDcfInputs(data);
  const { latest } = buildLatestAnnualFilingRows(data);
  const taxRate = dcf.financials.tax_rate ?? deriveTaxRate(latest);
  const totalDebt = dcf.financials.debt;
  const sharesOutstanding = dcf.financials.shares_outstanding;
  const interestExpense = latest?.metrics.interest_expense ?? null;
  const costOfDebt = deriveCostOfDebt(interestExpense, totalDebt);

  const quote = await fetchStockPrice(data.ticker);
  const currentSharePrice = finite(quote.price) ? quote.price : null;
  const marketValueEquity =
    currentSharePrice != null && sharesOutstanding != null
      ? Math.round(currentSharePrice * sharesOutstanding * 100) / 100
      : null;

  const financials: WaccFinancialInputs = {
    market_value_equity: marketValueEquity,
    total_debt: totalDebt,
    cost_of_equity: null,
    cost_of_debt: costOfDebt,
    corporate_tax_rate: taxRate,
    current_share_price: currentSharePrice,
    shares_outstanding: sharesOutstanding,
    beta: null,
    risk_free_rate: null,
    equity_risk_premium: null,
  };

  const sources: WaccInputsResponse["sources"] = {};
  if (financials.market_value_equity != null) {
    sources.market_value_equity = {
      filing_type: dcf.sources.shares_outstanding?.filing_type ?? latest?.form ?? null,
      filing_date: dcf.sources.shares_outstanding?.filing_date ?? latest?.filed ?? null,
      fiscal_period: dcf.sources.shares_outstanding?.fiscal_period ?? periodLabel(latest),
      fiscal_year: dcf.sources.shares_outstanding?.fiscal_year ?? latest?.fy ?? null,
      end: dcf.sources.shares_outstanding?.end ?? latest?.end ?? null,
      accession: dcf.sources.shares_outstanding?.accession ?? latest?.accessionNumber ?? null,
      note: `Derived from market quote (${quote.currency || "USD"}) × SEC shares outstanding`,
    };
  }
  if (financials.total_debt != null && dcf.sources.debt) {
    sources.total_debt = dcf.sources.debt;
  }
  if (financials.corporate_tax_rate != null && dcf.sources.tax_rate) {
    sources.corporate_tax_rate = dcf.sources.tax_rate;
  }
  if (financials.cost_of_debt != null) {
    sources.cost_of_debt = {
      ...(sourceFromRow(latest, "interest_expense") || {
        filing_type: latest?.form ?? null,
        filing_date: latest?.filed ?? null,
        fiscal_period: periodLabel(latest),
        fiscal_year: latest?.fy ?? null,
        end: latest?.end ?? null,
        accession: latest?.accessionNumber ?? null,
      }),
      note: "Derived from interest expense / total debt",
    };
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
  if (financials.shares_outstanding != null && dcf.sources.shares_outstanding) {
    sources.shares_outstanding = dcf.sources.shares_outstanding;
  }

  const missing: string[] = [];
  if (financials.market_value_equity == null) missing.push("Market Value of Equity");
  if (financials.total_debt == null) missing.push("Total Debt");
  if (financials.corporate_tax_rate == null) missing.push("Corporate Tax Rate");
  if (financials.cost_of_debt == null) missing.push("Cost of Debt");
  if (financials.current_share_price == null) missing.push("Current Share Price");
  if (financials.shares_outstanding == null) missing.push("Shares Outstanding");

  return {
    ticker: data.ticker,
    company_name: data.entityName || data.ticker,
    cik: data.cik || null,
    financials,
    sources,
    missing,
    explanation: EXPLANATION,
  };
}

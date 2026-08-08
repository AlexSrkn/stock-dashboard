import { fetchStockPrice } from "../../market/stockPrice.js";
import type { FilingsFundamentalsResponse } from "../../sec/financials/types.js";
import { normalizeCapex } from "../dcf/calculate.js";
import {
  buildLatestAnnualFilingRows,
  mapFilingsToDcfInputs,
  sourceFromRow,
} from "../dcf/filingInputs.js";
import { calculateEnterpriseValue } from "../ev/calculate.js";
import { resolveFreeCashFlow } from "./calculate.js";
import type { FcfYieldFinancialInputs, FcfYieldInputsResponse } from "./types.js";

const METHODOLOGY =
  "FCF Yield measures the free cash flow generated relative to a company's market value. Higher FCF yield generally means more cash generation relative to the valuation.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export async function mapFilingsToFcfYieldInputs(
  data: FilingsFundamentalsResponse
): Promise<FcfYieldInputsResponse> {
  const dcf = mapFilingsToDcfInputs(data);
  const { latest } = buildLatestAnnualFilingRows(data);

  const operatingCashFlow = finite(latest?.metrics.operating_cash_flow)
    ? latest!.metrics.operating_cash_flow!
    : null;
  const rawCapex = latest?.metrics.capital_expenditures ?? dcf.financials.capex;
  const capitalExpenditures = normalizeCapex(rawCapex);
  const derivedFcf = finite(latest?.derived?.free_cash_flow)
    ? latest!.derived!.free_cash_flow!
    : null;
  const resolved = resolveFreeCashFlow({
    operating_cash_flow: operatingCashFlow,
    capital_expenditures: capitalExpenditures,
    free_cash_flow: derivedFcf,
  });

  const quote = await fetchStockPrice(data.ticker);
  const currentSharePrice = finite(quote.price) ? quote.price : null;
  const sharesOutstanding = dcf.financials.shares_outstanding;
  const marketCap =
    currentSharePrice != null && sharesOutstanding != null && sharesOutstanding > 0
      ? Math.round(currentSharePrice * sharesOutstanding * 100) / 100
      : null;

  const totalDebt = dcf.financials.debt;
  const cash = dcf.financials.cash;
  let enterpriseValue: number | null = null;
  if (marketCap != null && finite(totalDebt) && finite(cash)) {
    const ev = calculateEnterpriseValue({
      current_share_price: currentSharePrice,
      shares_outstanding: sharesOutstanding,
      market_cap: marketCap,
      market_cap_mode: "manual",
      total_debt: totalDebt,
      cash,
    });
    enterpriseValue = ev.ok ? ev.enterprise_value : null;
  }

  const financials: FcfYieldFinancialInputs = {
    operating_cash_flow: operatingCashFlow,
    capital_expenditures: capitalExpenditures,
    free_cash_flow: resolved.fcf,
    current_share_price: currentSharePrice,
    shares_outstanding: sharesOutstanding,
    market_cap: marketCap,
    total_debt: totalDebt,
    cash,
    enterprise_value: enterpriseValue,
  };

  const sources: FcfYieldInputsResponse["sources"] = {};
  if (financials.operating_cash_flow != null) {
    sources.operating_cash_flow = sourceFromRow(latest, "operating_cash_flow") ?? {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: null,
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
    };
  }
  if (financials.capital_expenditures != null) {
    sources.capital_expenditures = dcf.sources.capex ?? {
      ...(sourceFromRow(latest, "capital_expenditures") || {
        filing_type: latest?.form ?? null,
        filing_date: latest?.filed ?? null,
        fiscal_period: null,
        fiscal_year: latest?.fy ?? null,
        end: latest?.end ?? null,
        accession: latest?.accessionNumber ?? null,
      }),
      note: "Shown as absolute CapEx outflow",
    };
  }
  if (financials.free_cash_flow != null) {
    sources.free_cash_flow = {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: sources.operating_cash_flow?.fiscal_period ?? null,
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
      note: "Derived: Operating Cash Flow − CapEx",
    };
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
  if (financials.enterprise_value != null) {
    sources.enterprise_value = {
      filing_type: dcf.sources.debt?.filing_type ?? null,
      filing_date: dcf.sources.debt?.filing_date ?? null,
      fiscal_period: dcf.sources.debt?.fiscal_period ?? null,
      fiscal_year: dcf.sources.debt?.fiscal_year ?? null,
      end: dcf.sources.debt?.end ?? null,
      accession: dcf.sources.debt?.accession ?? null,
      note: "Derived: Market Cap + Total Debt − Cash",
    };
  }

  const missing: string[] = [];
  if (financials.operating_cash_flow == null) missing.push("Operating Cash Flow");
  if (financials.capital_expenditures == null) missing.push("Capital Expenditures");
  if (financials.free_cash_flow == null) missing.push("Free Cash Flow");
  if (financials.market_cap == null) missing.push("Market Capitalization");
  if (financials.enterprise_value == null) missing.push("Enterprise Value");

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

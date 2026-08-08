import { fetchStockPrice } from "../../market/stockPrice.js";
import type { FilingsFundamentalsResponse } from "../../sec/financials/types.js";
import {
  buildLatestAnnualFilingRows,
  mapFilingsToDcfInputs,
  sourceFromRow,
} from "../dcf/filingInputs.js";
import { resolveEps } from "./calculate.js";
import type { PeFinancialInputs, PeInputsResponse } from "./types.js";

const METHODOLOGY =
  "P/E valuation estimates a company's implied share price by applying a selected earnings multiple to earnings per share.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export async function mapFilingsToPeInputs(
  data: FilingsFundamentalsResponse
): Promise<PeInputsResponse> {
  const dcf = mapFilingsToDcfInputs(data);
  const { latest } = buildLatestAnnualFilingRows(data);

  const dilutedEps = finite(latest?.metrics.eps_diluted) ? latest!.metrics.eps_diluted! : null;
  const netIncome = finite(latest?.metrics.net_income) ? latest!.metrics.net_income! : null;
  const sharesOutstanding = dcf.financials.shares_outstanding;

  const quote = await fetchStockPrice(data.ticker);
  const currentSharePrice = finite(quote.price) ? quote.price : null;

  const derived = resolveEps({
    diluted_eps: dilutedEps,
    net_income: netIncome,
    shares_outstanding: sharesOutstanding,
  });
  const derivedEps =
    derived.source === "derived" && derived.eps != null ? derived.eps : null;

  const financials: PeFinancialInputs = {
    diluted_eps: dilutedEps,
    net_income: netIncome,
    shares_outstanding: sharesOutstanding,
    current_share_price: currentSharePrice,
    derived_eps: derivedEps,
  };

  const sources: PeInputsResponse["sources"] = {};
  if (financials.diluted_eps != null) {
    sources.diluted_eps = sourceFromRow(latest, "eps_diluted") ?? {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: null,
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
    };
  }
  if (financials.net_income != null) {
    sources.net_income = sourceFromRow(latest, "net_income") ?? {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: null,
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
    };
  }
  if (financials.shares_outstanding != null && dcf.sources.shares_outstanding) {
    sources.shares_outstanding = dcf.sources.shares_outstanding;
  }
  if (financials.derived_eps != null) {
    sources.derived_eps = {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: dcf.sources.shares_outstanding?.fiscal_period ?? null,
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
      note: "Derived from net income ÷ diluted shares outstanding",
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

  const missing: string[] = [];
  if (financials.diluted_eps == null && financials.derived_eps == null) {
    missing.push("Diluted EPS");
  }
  if (financials.net_income == null) missing.push("Net Income");
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

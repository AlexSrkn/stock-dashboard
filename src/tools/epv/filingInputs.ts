import { fetchStockPrice } from "../../market/stockPrice.js";
import type { FilingsFundamentalsResponse } from "../../sec/financials/types.js";
import {
  buildLatestAnnualFilingRows,
  mapFilingsToDcfInputs,
  periodLabel,
  pickAnnualRows,
} from "../dcf/filingInputs.js";
import type {
  EpvFinancialInputs,
  EpvHistoricalMargin,
  EpvInputsResponse,
} from "./types.js";

const METHODOLOGY =
  "EPV estimates the value of a company based on sustainable normalized earnings without assuming future growth.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function operatingMargin(revenue: number | null | undefined, ebit: number | null | undefined): number | null {
  if (!finite(revenue) || revenue <= 0 || !finite(ebit)) return null;
  return Math.round((ebit / revenue) * 10000) / 10000;
}

export function buildHistoricalMargins(data: FilingsFundamentalsResponse): EpvHistoricalMargin[] {
  const incomeAnnual = data.statements?.incomeStatement?.annual || data.annual || [];
  const fyRows = (incomeAnnual.length ? incomeAnnual : pickAnnualRows(data))
    .filter((r) => !r.fp || r.fp === "FY")
    .slice()
    .sort((a, b) => (a.fy ?? 0) - (b.fy ?? 0));

  const out: EpvHistoricalMargin[] = [];
  for (const row of fyRows) {
    const revenue = finite(row.metrics.revenue) ? row.metrics.revenue! : null;
    const ebit = finite(row.metrics.operating_income) ? row.metrics.operating_income! : null;
    const margin =
      (finite(row.derived?.operating_margin) ? row.derived!.operating_margin! / 100 : null) ??
      operatingMargin(revenue, ebit);
    if (revenue == null && ebit == null && margin == null) continue;
    out.push({
      fiscal_year: row.fy,
      fiscal_period: periodLabel(row),
      end: row.end,
      revenue,
      ebit,
      operating_margin: margin,
      filing_type: row.form,
      filing_date: row.filed,
    });
  }
  return out.slice(-8);
}

function averageEbit(rows: EpvHistoricalMargin[]): number | null {
  const values = rows.map((r) => r.ebit).filter((n): n is number => finite(n));
  if (!values.length) return null;
  return Math.round((values.reduce((s, n) => s + n, 0) / values.length) * 100) / 100;
}

function suggestedMargin(rows: EpvHistoricalMargin[]): number | null {
  const values = rows
    .map((r) => r.operating_margin)
    .filter((n): n is number => finite(n));
  if (!values.length) return null;
  return Math.round((values.reduce((s, n) => s + n, 0) / values.length) * 10000) / 10000;
}

export async function mapFilingsToEpvInputs(
  data: FilingsFundamentalsResponse
): Promise<EpvInputsResponse> {
  const dcf = mapFilingsToDcfInputs(data);
  const { latest } = buildLatestAnnualFilingRows(data);
  const historical_margins = buildHistoricalMargins(data);
  const average_ebit = averageEbit(historical_margins);
  const suggested_normalized_margin = suggestedMargin(historical_margins);

  const quote = await fetchStockPrice(data.ticker);
  const current_share_price = finite(quote.price) ? quote.price : null;

  const financials: EpvFinancialInputs = {
    revenue: dcf.financials.revenue,
    ebit: dcf.financials.ebit,
    tax_rate: dcf.financials.tax_rate,
    depreciation: dcf.financials.depreciation,
    cash: dcf.financials.cash,
    debt: dcf.financials.debt,
    shares_outstanding: dcf.financials.shares_outstanding,
    current_share_price,
    average_ebit,
    suggested_normalized_margin,
  };

  const sources: EpvInputsResponse["sources"] = {};
  if (financials.revenue != null && dcf.sources.revenue) sources.revenue = dcf.sources.revenue;
  if (financials.ebit != null && dcf.sources.ebit) sources.ebit = dcf.sources.ebit;
  if (financials.tax_rate != null && dcf.sources.tax_rate) sources.tax_rate = dcf.sources.tax_rate;
  if (financials.depreciation != null && dcf.sources.depreciation) {
    sources.depreciation = dcf.sources.depreciation;
  }
  if (financials.cash != null && dcf.sources.cash) sources.cash = dcf.sources.cash;
  if (financials.debt != null && dcf.sources.debt) sources.debt = dcf.sources.debt;
  if (financials.shares_outstanding != null && dcf.sources.shares_outstanding) {
    sources.shares_outstanding = dcf.sources.shares_outstanding;
  }
  if (financials.average_ebit != null) {
    sources.average_ebit = {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: periodLabel(latest),
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
      note: `Average of ${historical_margins.filter((r) => finite(r.ebit)).length} annual EBIT observations`,
    };
  }
  if (financials.suggested_normalized_margin != null) {
    sources.suggested_normalized_margin = {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: periodLabel(latest),
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
      note: "Average historical operating margin from SEC filings",
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
  if (financials.revenue == null) missing.push("Revenue");
  if (financials.ebit == null) missing.push("Operating Income / EBIT");
  if (financials.tax_rate == null) missing.push("Tax Rate");
  if (financials.depreciation == null) missing.push("Depreciation & Amortization");
  if (financials.cash == null) missing.push("Cash");
  if (financials.debt == null) missing.push("Total Debt");
  if (financials.shares_outstanding == null) missing.push("Diluted Shares Outstanding");
  if (!historical_margins.length) missing.push("Historical operating margins");
  if (financials.current_share_price == null) missing.push("Current Share Price");

  return {
    ticker: data.ticker,
    company_name: data.entityName || data.ticker,
    cik: data.cik || null,
    financials,
    historical_margins,
    sources,
    missing,
    methodology: METHODOLOGY,
  };
}

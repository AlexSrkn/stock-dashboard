import type { FilingsFundamentalsResponse, FinancialPeriodRow } from "../../sec/financials/types.js";
import { computeUnleveredFcf, normalizeCapex } from "./calculate.js";
import type { DcfFilingInputsResponse, DcfFinancialInputs, DcfSourceRef } from "./types.js";

const DISCLAIMER =
  "DCF valuation is an estimate based on user-selected assumptions and is not investment advice.";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function periodLabel(row: FinancialPeriodRow | null | undefined): string | null {
  if (!row) return null;
  if (row.fp === "FY" && row.fy != null) return `FY ${row.fy}`;
  if (row.fp && row.fy != null) return `${row.fp} ${row.fy}`;
  return row.fp || (row.fy != null ? String(row.fy) : null);
}

export function sourceFromRow(
  row: FinancialPeriodRow | null | undefined,
  metricKey?: string
): DcfSourceRef | undefined {
  if (!row) return undefined;
  const src = metricKey
    ? row.metricSources?.[metricKey as keyof typeof row.metricSources]
    : undefined;
  return {
    filing_type: src?.form ?? row.form,
    filing_date: src?.filed ?? row.filed,
    fiscal_period: periodLabel(row),
    fiscal_year: row.fy,
    end: row.end,
    accession: src?.accn ?? row.accessionNumber,
    note: null,
  };
}

function netWorkingCapital(row: FinancialPeriodRow): number | null {
  const ca = row.metrics.current_assets;
  const cash = row.metrics.cash_and_equivalents;
  const cl = row.metrics.current_liabilities;
  const currentDebt = row.metrics.current_debt;
  if (!finite(ca) || !finite(cl)) return null;
  const nonCashCA = ca - (finite(cash) ? cash : 0);
  const nonDebtCL = cl - (finite(currentDebt) ? currentDebt : 0);
  return nonCashCA - nonDebtCL;
}

/**
 * Effective tax rate from period metrics.
 * Prefer tax / (EBIT) when EBIT > 0; else tax / (NI + tax) pretax proxy.
 * Returns decimal (e.g. 0.21) or null.
 */
export function deriveTaxRate(row: FinancialPeriodRow | null | undefined): number | null {
  if (!row) return null;
  const tax = row.metrics.income_tax_expense;
  if (!finite(tax)) return null;
  const ebit = row.metrics.operating_income;
  if (finite(ebit) && ebit > 0) {
    const rate = tax / ebit;
    if (rate >= 0 && rate < 1) return Math.round(rate * 10000) / 10000;
  }
  const ni = row.metrics.net_income;
  if (finite(ni)) {
    const pretax = ni + tax;
    if (pretax > 0) {
      const rate = tax / pretax;
      if (rate >= 0 && rate < 1) return Math.round(rate * 10000) / 10000;
    }
  }
  return null;
}

export function deriveChangeInWorkingCapital(
  current: FinancialPeriodRow | null | undefined,
  prior: FinancialPeriodRow | null | undefined
): number | null {
  if (!current || !prior) return null;
  const nwcNow = netWorkingCapital(current);
  const nwcPrior = netWorkingCapital(prior);
  if (nwcNow == null || nwcPrior == null) return null;
  return Math.round((nwcNow - nwcPrior) * 100) / 100;
}

export function pickAnnualRows(data: FilingsFundamentalsResponse): FinancialPeriodRow[] {
  const annual =
    data.statements?.incomeStatement?.annual?.length
      ? data.statements.incomeStatement.annual
      : data.annual || [];
  // Prefer FY rows, newest first (already typically newest-first)
  return annual.filter((r) => r.fp === "FY" || !r.fp || r.fp === "FY");
}

export function mergeBalanceInto(
  incomeRow: FinancialPeriodRow,
  balanceRows: FinancialPeriodRow[]
): FinancialPeriodRow {
  const match =
    balanceRows.find(
      (b) =>
        (incomeRow.fy != null && b.fy === incomeRow.fy && (b.fp === incomeRow.fp || b.fp === "FY")) ||
        (incomeRow.end && b.end === incomeRow.end)
    ) || balanceRows[0];
  if (!match) return incomeRow;
  return {
    ...incomeRow,
    metrics: { ...match.metrics, ...incomeRow.metrics },
    metricSources: { ...match.metricSources, ...incomeRow.metricSources },
    derived: { ...match.derived, ...incomeRow.derived },
    form: incomeRow.form || match.form,
    filed: incomeRow.filed || match.filed,
  };
}

export function mergeCashFlowInto(
  incomeRow: FinancialPeriodRow,
  cashRows: FinancialPeriodRow[]
): FinancialPeriodRow {
  const match =
    cashRows.find(
      (b) =>
        (incomeRow.fy != null && b.fy === incomeRow.fy && (b.fp === incomeRow.fp || b.fp === "FY")) ||
        (incomeRow.end && b.end === incomeRow.end)
    ) || cashRows[0];
  if (!match) return incomeRow;
  return {
    ...incomeRow,
    metrics: { ...incomeRow.metrics, ...match.metrics },
    metricSources: { ...incomeRow.metricSources, ...match.metricSources },
    derived: { ...incomeRow.derived, ...match.derived },
  };
}

export function mapFilingsToDcfInputs(
  data: FilingsFundamentalsResponse
): DcfFilingInputsResponse {
  const incomeAnnual = data.statements?.incomeStatement?.annual || data.annual || [];
  const balanceAnnual = data.statements?.balanceSheet?.annual || [];
  const cashAnnual = data.statements?.cashFlow?.annual || [];

  const fyIncome = (incomeAnnual.length ? incomeAnnual : pickAnnualRows(data)).filter(
    (r) => !r.fp || r.fp === "FY"
  );
  const latestIncome = fyIncome[0] || incomeAnnual[0] || null;
  const priorIncome = fyIncome[1] || incomeAnnual[1] || null;

  let latest = latestIncome;
  let prior = priorIncome;
  if (latest) {
    latest = mergeBalanceInto(latest, balanceAnnual.filter((r) => !r.fp || r.fp === "FY"));
    latest = mergeCashFlowInto(latest, cashAnnual.filter((r) => !r.fp || r.fp === "FY"));
  }
  if (prior) {
    prior = mergeBalanceInto(prior, balanceAnnual.filter((r) => !r.fp || r.fp === "FY"));
    prior = mergeCashFlowInto(prior, cashAnnual.filter((r) => !r.fp || r.fp === "FY"));
  }

  // Prefer latest balance sheet for cash/debt/shares (may be more recent quarterly)
  const balanceLatest =
    data.statements?.balanceSheet?.latest ||
    data.statements?.balanceSheet?.quarterly?.[0] ||
    null;
  const latestQuarter = data.statements?.balanceSheet?.quarterly?.[0] || null;

  const revenue = latest?.metrics.revenue ?? null;
  const ebit = latest?.metrics.operating_income ?? null;
  const tax_rate = deriveTaxRate(latest);
  const depreciation = latest?.metrics.depreciation_amortization ?? null;
  const rawCapex = latest?.metrics.capital_expenditures ?? null;
  const capex = normalizeCapex(rawCapex);
  const change_in_working_capital = deriveChangeInWorkingCapital(latest, prior);

  const cashFromPeriod =
    latest?.metrics.cash_and_equivalents ??
    (balanceLatest && "cash_and_equivalents" in balanceLatest
      ? (balanceLatest as { cash_and_equivalents?: { value?: number } }).cash_and_equivalents?.value
      : null) ??
    latestQuarter?.metrics.cash_and_equivalents ??
    null;

  // balanceSheet.latest is ExtractedMetricValue map
  const cashFromLatestDetail = data.statements?.balanceSheet?.latest?.cash_and_equivalents?.value;
  const cash =
    (finite(cashFromLatestDetail) ? cashFromLatestDetail : null) ??
    (finite(cashFromPeriod) ? cashFromPeriod : null);

  const debt =
    (finite(latest?.derived?.total_debt) ? latest!.derived.total_debt! : null) ??
    (finite(data.derivedLatest?.total_debt) ? data.derivedLatest.total_debt! : null) ??
    (finite(latest?.metrics.debt) ? latest!.metrics.debt! : null) ??
    (finite(data.statements?.balanceSheet?.latest?.debt?.value)
      ? data.statements!.balanceSheet.latest.debt!.value
      : null);

  const shares =
    (finite(latest?.metrics.weighted_average_diluted_shares)
      ? latest!.metrics.weighted_average_diluted_shares!
      : null) ??
    (finite(latest?.metrics.shares_outstanding) ? latest!.metrics.shares_outstanding! : null) ??
    (finite(data.statements?.balanceSheet?.latest?.shares_outstanding?.value)
      ? data.statements!.balanceSheet.latest.shares_outstanding!.value
      : null) ??
    (finite(data.statements?.incomeStatement?.latest?.weighted_average_diluted_shares?.value)
      ? data.statements!.incomeStatement.latest.weighted_average_diluted_shares!.value
      : null);

  const ebitda =
    (finite(latest?.derived?.ebitda) ? latest!.derived.ebitda! : null) ??
    (finite(data.derivedLatest?.ebitda) ? data.derivedLatest.ebitda! : null);

  const financials: DcfFinancialInputs = {
    revenue: finite(revenue) ? revenue : null,
    ebit: finite(ebit) ? ebit : null,
    tax_rate: finite(tax_rate) ? tax_rate : null,
    depreciation: finite(depreciation) ? depreciation : null,
    capex: finite(capex) ? capex : null,
    change_in_working_capital: finite(change_in_working_capital)
      ? change_in_working_capital
      : null,
    cash: finite(cash) ? cash : null,
    debt: finite(debt) ? debt : null,
    shares_outstanding: finite(shares) ? shares : null,
    current_share_price: null,
    ebitda: finite(ebitda) ? ebitda : null,
  };

  const sources: DcfFilingInputsResponse["sources"] = {};
  if (financials.revenue != null) sources.revenue = sourceFromRow(latest, "revenue");
  if (financials.ebit != null) sources.ebit = sourceFromRow(latest, "operating_income");
  if (financials.tax_rate != null) {
    sources.tax_rate = {
      ...(sourceFromRow(latest, "income_tax_expense") || {
        filing_type: latest?.form ?? null,
        filing_date: latest?.filed ?? null,
        fiscal_period: periodLabel(latest),
        fiscal_year: latest?.fy ?? null,
        end: latest?.end ?? null,
        accession: latest?.accessionNumber ?? null,
      }),
      note: "Derived from income tax expense / EBIT (or pretax income)",
    };
  }
  if (financials.depreciation != null) {
    sources.depreciation = sourceFromRow(latest, "depreciation_amortization");
  }
  if (financials.capex != null) {
    sources.capex = {
      ...(sourceFromRow(latest, "capital_expenditures") || {
        filing_type: latest?.form ?? null,
        filing_date: latest?.filed ?? null,
        fiscal_period: periodLabel(latest),
        fiscal_year: latest?.fy ?? null,
        end: latest?.end ?? null,
        accession: latest?.accessionNumber ?? null,
      }),
      note: "Shown as absolute CapEx outflow",
    };
  }
  if (financials.change_in_working_capital != null) {
    sources.change_in_working_capital = {
      filing_type: latest?.form ?? null,
      filing_date: latest?.filed ?? null,
      fiscal_period: periodLabel(latest),
      fiscal_year: latest?.fy ?? null,
      end: latest?.end ?? null,
      accession: latest?.accessionNumber ?? null,
      note: "Derived from year-over-year change in net working capital",
    };
  }
  if (financials.cash != null) {
    const cashSrc = data.statements?.balanceSheet?.latest?.cash_and_equivalents;
    sources.cash = cashSrc
      ? {
          filing_type: cashSrc.form,
          filing_date: cashSrc.filed,
          fiscal_period:
            cashSrc.fp === "FY" && cashSrc.fy != null
              ? `FY ${cashSrc.fy}`
              : cashSrc.fp && cashSrc.fy != null
                ? `${cashSrc.fp} ${cashSrc.fy}`
                : cashSrc.fp,
          fiscal_year: cashSrc.fy,
          end: cashSrc.end,
          accession: cashSrc.accn,
          note: null,
        }
      : sourceFromRow(latest, "cash_and_equivalents");
  }
  if (financials.debt != null) {
    sources.debt = {
      ...(sourceFromRow(latest, "long_term_debt") || {
        filing_type: latest?.form ?? null,
        filing_date: latest?.filed ?? null,
        fiscal_period: periodLabel(latest),
        fiscal_year: latest?.fy ?? null,
        end: latest?.end ?? null,
        accession: latest?.accessionNumber ?? null,
      }),
      note: "Total debt = current debt + long-term debt when available",
    };
  }
  if (financials.shares_outstanding != null) {
    sources.shares_outstanding = sourceFromRow(
      latest,
      finite(latest?.metrics.weighted_average_diluted_shares)
        ? "weighted_average_diluted_shares"
        : "shares_outstanding"
    );
  }
  if (financials.ebitda != null) {
    sources.ebitda = {
      ...(sourceFromRow(latest, "operating_income") || {
        filing_type: latest?.form ?? null,
        filing_date: latest?.filed ?? null,
        fiscal_period: periodLabel(latest),
        fiscal_year: latest?.fy ?? null,
        end: latest?.end ?? null,
        accession: latest?.accessionNumber ?? null,
      }),
      note: "Derived: EBIT + D&A",
    };
  }

  const fcf_components = computeUnleveredFcf({
    ebit: financials.ebit,
    tax_rate: financials.tax_rate,
    depreciation: financials.depreciation,
    capex: financials.capex,
    change_in_working_capital: financials.change_in_working_capital,
  });

  const missing: string[] = [];
  const labels: Record<keyof DcfFinancialInputs, string> = {
    revenue: "Revenue",
    ebit: "EBIT",
    tax_rate: "Tax rate",
    depreciation: "Depreciation & amortization",
    capex: "Capital expenditures",
    change_in_working_capital: "Change in working capital",
    cash: "Cash",
    debt: "Total debt",
    shares_outstanding: "Shares outstanding",
    current_share_price: "Current share price",
    ebitda: "EBITDA",
  };
  for (const key of Object.keys(labels) as (keyof DcfFinancialInputs)[]) {
    if (key === "current_share_price") continue; // always manual
    if (key === "ebitda") continue; // optional helper
    if (financials[key] == null) missing.push(labels[key]);
  }

  return {
    ticker: data.ticker,
    company_name: data.entityName || data.ticker,
    cik: data.cik || null,
    financials,
    sources,
    fcf_components,
    missing,
    disclaimer: DISCLAIMER,
  };
}

export function buildLatestAnnualFilingRows(data: FilingsFundamentalsResponse): {
  latest: FinancialPeriodRow | null;
  prior: FinancialPeriodRow | null;
} {
  const incomeAnnual = data.statements?.incomeStatement?.annual || data.annual || [];
  const balanceAnnual = data.statements?.balanceSheet?.annual || [];
  const cashAnnual = data.statements?.cashFlow?.annual || [];

  const fyIncome = (incomeAnnual.length ? incomeAnnual : pickAnnualRows(data)).filter(
    (r) => !r.fp || r.fp === "FY"
  );
  const latestIncome = fyIncome[0] || incomeAnnual[0] || null;
  const priorIncome = fyIncome[1] || incomeAnnual[1] || null;

  let latest = latestIncome;
  let prior = priorIncome;
  if (latest) {
    latest = mergeBalanceInto(latest, balanceAnnual.filter((r) => !r.fp || r.fp === "FY"));
    latest = mergeCashFlowInto(latest, cashAnnual.filter((r) => !r.fp || r.fp === "FY"));
  }
  if (prior) {
    prior = mergeBalanceInto(prior, balanceAnnual.filter((r) => !r.fp || r.fp === "FY"));
    prior = mergeCashFlowInto(prior, cashAnnual.filter((r) => !r.fp || r.fp === "FY"));
  }
  return { latest, prior };
}

export type StatementSection = "income" | "balance" | "cashflow";

export type FinancialMetricKey =
  | "revenue"
  | "gross_profit"
  | "operating_income"
  | "net_income"
  | "eps_basic"
  | "eps_diluted"
  | "total_assets"
  | "total_liabilities"
  | "shareholder_equity"
  | "cash_and_equivalents"
  | "operating_cash_flow"
  | "capital_expenditures"
  | "debt"
  | "shares_outstanding"
  // --- Additional direct SEC metrics ---
  | "current_assets"
  | "current_liabilities"
  | "long_term_debt"
  | "current_debt"
  | "commercial_paper"
  | "notes_carrying_amount"
  | "inventory"
  | "accounts_receivable"
  | "property_plant_equipment"
  | "goodwill"
  | "research_and_development_expense"
  | "selling_general_administrative_expense"
  | "interest_expense"
  | "income_tax_expense"
  | "depreciation_amortization"
  | "investing_cash_flow"
  | "financing_cash_flow"
  | "dividends_paid"
  | "share_repurchases"
  | "weighted_average_diluted_shares";

export type DerivedMetricKey =
  | "free_cash_flow"
  | "gross_margin"
  | "operating_margin"
  | "net_margin"
  | "revenue_growth_yoy"
  | "eps_growth_yoy"
  // --- Additional derived metrics ---
  | "total_debt"
  | "ebitda"
  | "roe"
  | "roa"
  | "current_ratio"
  | "debt_to_equity"
  | "asset_turnover"
  | "book_value_per_share"
  | "free_cash_flow_margin";

export interface FinancialMetricDefinition {
  key: FinancialMetricKey;
  label: string;
  statement: StatementSection;
  /** Duration facts (income/cash flow) vs instant (balance sheet). */
  valueType: "duration" | "instant";
  tags: string[];
  unit: string;
}

export interface XbrlFactObservation {
  end?: string;
  start?: string;
  val: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
  instant?: string;
}

export interface XbrlFactConcept {
  label?: string;
  description?: string;
  units?: Record<string, XbrlFactObservation[]>;
}

export interface SecCompanyFacts {
  cik: string | number;
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<string, XbrlFactConcept>;
    "ifrs-full"?: Record<string, XbrlFactConcept>;
    dei?: Record<string, XbrlFactConcept>;
    [namespace: string]: Record<string, XbrlFactConcept> | undefined;
  };
}

export interface MetricSourceRef {
  gaapTag: string;
  namespace: string;
  accn: string | null;
  filed: string | null;
  form: string | null;
}

export interface MetricValueDetail {
  reportedValue: number;
  /** Standalone quarter when known; null when only YTD was reported and not derived. */
  normalizedQuarterValue: number | null;
  durationDays: number | null;
  durationBucket?: import("./periodUtils.js").DurationBucket | null;
  /** True when normalizedQuarterValue came from current YTD − prior YTD. */
  derivedStandalone?: boolean;
  /** Prior YTD value used in derivation (when derivedStandalone). */
  priorReportedValue?: number | null;
  priorEnd?: string | null;
  priorAccn?: string | null;
  priorFiled?: string | null;
  priorForm?: string | null;
  priorDurationBucket?: import("./periodUtils.js").DurationBucket | null;
}

export interface CashFlowDerivationProvenance {
  method: "ytd_minus_prior_ytd";
  current: {
    value: number;
    end: string | null;
    accn: string | null;
    filed: string | null;
    form: string | null;
    durationBucket: import("./periodUtils.js").DurationBucket | null;
  };
  prior: {
    value: number;
    end: string | null;
    accn: string | null;
    filed: string | null;
    form: string | null;
    durationBucket: import("./periodUtils.js").DurationBucket | null;
  };
}

export interface ExtractedMetricValue {
  key: FinancialMetricKey;
  label: string;
  value: number;
  unit: string;
  end: string | null;
  filed: string | null;
  form: string | null;
  accn: string | null;
  /** SEC fiscal period tag (Q1/Q2/Q3/FY) for the filing row. */
  fp: string | null;
  /**
   * Display period for this metric's value (e.g. "9M YTD", "Q3 · derived").
   * Prefer this over `fp` when presenting cash-flow / duration facts.
   */
  periodLabel?: string | null;
  fy: number | null;
  gaapTag: string;
  namespace: string;
  durationBucket?: import("./periodUtils.js").DurationBucket | null;
  /** Present when value is a standalone quarter derived from YTD − prior YTD. */
  derivation?: CashFlowDerivationProvenance | null;
}

export type CashFlowLatestMetrics = Partial<Record<FinancialMetricKey, ExtractedMetricValue>> & {
  /** Derived FCF aligned to the same period basis as sibling cash-flow metrics. */
  free_cash_flow?: {
    value: number;
    unit: string;
    end: string | null;
    fp: string | null;
    periodLabel: string | null;
    derivation?: CashFlowDerivationProvenance | null;
  };
};

export interface FinancialPeriodRow {
  end: string;
  filed: string | null;
  form: string | null;
  fp: string | null;
  fy: number | null;
  accessionNumber: string | null;
  /** Display values (normalized quarter for 10-Q duration metrics). */
  metrics: Partial<Record<FinancialMetricKey, number>>;
  metricDetails: Partial<Record<FinancialMetricKey, MetricValueDetail>>;
  metricSources: Partial<Record<FinancialMetricKey, MetricSourceRef>>;
  derived: Partial<Record<DerivedMetricKey, number>>;
  validationFlags?: string[];
  /** Why this row was included in period tables (primary metrics present). */
  inclusionReason?: string;
  /** Hierarchy-aware total debt components for the same balance-sheet date. */
  totalDebtProvenance?: import("./debtResolve.js").TotalDebtResolution | null;
  /** ROE / ROA / asset turnover period basis + provenance. */
  returnMetricsProvenance?: import("./returnMetrics.js").RowReturnMetrics | null;
}

export interface StatementBundle {
  /** Reported filing values (for cash flow: often YTD). */
  latest: CashFlowLatestMetrics;
  /**
   * Standalone latest-quarter cash-flow metrics derived as current YTD − prior YTD.
   * Only populated for cash-flow when derivation is possible.
   */
  latestDerivedQuarter?: CashFlowLatestMetrics;
  annual: FinancialPeriodRow[];
  quarterly: FinancialPeriodRow[];
}

export interface SecFinancialFilingRow {
  form: string;
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  primaryDocument: string;
  description: string;
  items: string | null;
  isXBRL: boolean;
  href: string;
}

export interface EarningsReleaseRow {
  form: string;
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  items: string | null;
  href: string;
  metrics: Partial<Record<FinancialMetricKey, number>>;
  metricSources: Partial<Record<FinancialMetricKey, MetricSourceRef>>;
}

export interface FilingsFundamentalsResponse {
  ticker: string;
  cik: string;
  entityName: string;
  source: "sec-company-facts";
  /**
   * When this listing has no SEC companyfacts (common for dual-listed siblings),
   * fundamentals were loaded from this related ticker (e.g. RTNTF → RIO).
   */
  fundamentalsSourceTicker?: string | null;
  classification: {
    sector: string | null;
    industry: string | null;
    sic: string | null;
    sicDescription: string | null;
  } | null;
  /** @deprecated use statements — kept for compatibility */
  latest: Partial<Record<FinancialMetricKey, ExtractedMetricValue>>;
  annual: FinancialPeriodRow[];
  quarterly: FinancialPeriodRow[];
  statements: {
    incomeStatement: StatementBundle;
    balanceSheet: StatementBundle;
    cashFlow: StatementBundle;
  };
  derivedLatest: Partial<Record<DerivedMetricKey, number>>;
  /** Period basis labels for return metrics, e.g. { roe: "TTM", roa: "FY" }. */
  derivedPeriodLabels?: Partial<Record<"roe" | "roa" | "asset_turnover", string>>;
  earningsReleases: EarningsReleaseRow[];
  filings: {
    "10-K": SecFinancialFilingRow[];
    "10-Q": SecFinancialFilingRow[];
    "8-K": SecFinancialFilingRow[];
  };
}

import type { FinancialMetricDefinition, FinancialMetricKey, StatementSection } from "./types.js";

export const FINANCIAL_METRIC_DEFINITIONS: FinancialMetricDefinition[] = [
  {
    key: "revenue",
    label: "Revenue",
    statement: "income",
    valueType: "duration",
    tags: [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
      "SalesRevenueGoodsNet",
      "RevenueFromContractWithCustomerExcludingAssessedTaxAndOther",
      // IFRS (20-F / foreign filers)
      "Revenue",
      "RevenueFromContractsWithCustomers",
    ],
    unit: "USD",
  },
  {
    key: "gross_profit",
    label: "Gross profit",
    statement: "income",
    valueType: "duration",
    tags: ["GrossProfit", "GrossProfitLoss"],
    unit: "USD",
  },
  {
    key: "operating_income",
    label: "Operating income",
    statement: "income",
    valueType: "duration",
    tags: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
    unit: "USD",
  },
  {
    key: "net_income",
    label: "Net income",
    statement: "income",
    valueType: "duration",
    tags: [
      "NetIncomeLoss",
      "ProfitLoss",
      "ProfitLossAttributableToOwnersOfParent",
      "NetIncomeLossAvailableToCommonStockholdersBasic",
    ],
    unit: "USD",
  },
  {
    key: "eps_basic",
    label: "EPS (basic)",
    statement: "income",
    valueType: "duration",
    tags: ["EarningsPerShareBasic", "BasicEarningsLossPerShare"],
    unit: "USD/shares",
  },
  {
    key: "eps_diluted",
    label: "EPS (diluted)",
    statement: "income",
    valueType: "duration",
    tags: ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"],
    unit: "USD/shares",
  },
  {
    key: "total_assets",
    label: "Total assets",
    statement: "balance",
    valueType: "instant",
    tags: ["Assets", "NoncurrentAssets", "CurrentAssets"],
    unit: "USD",
  },
  {
    key: "total_liabilities",
    label: "Total liabilities",
    statement: "balance",
    valueType: "instant",
    tags: ["Liabilities"],
    unit: "USD",
  },
  {
    key: "shareholder_equity",
    label: "Shareholder equity",
    statement: "balance",
    valueType: "instant",
    tags: [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      "EquityAttributableToOwnersOfParent",
      "Equity",
    ],
    unit: "USD",
  },
  {
    key: "cash_and_equivalents",
    label: "Cash & equivalents",
    statement: "balance",
    valueType: "instant",
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "CashCashEquivalentsAndShortTermInvestments",
      "CashAndCashEquivalents",
      "Cash",
    ],
    unit: "USD",
  },
  {
    key: "operating_cash_flow",
    label: "Operating cash flow",
    statement: "cashflow",
    valueType: "duration",
    tags: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
      "CashFlowsFromUsedInOperatingActivities",
    ],
    unit: "USD",
  },
  {
    key: "capital_expenditures",
    label: "Capital expenditures",
    statement: "cashflow",
    valueType: "duration",
    tags: [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PaymentsToAcquireOtherPropertyPlantAndEquipment",
      "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
      "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets",
    ],
    unit: "USD",
  },
  {
    key: "debt",
    label: "Debt",
    statement: "balance",
    valueType: "instant",
    // Legacy single-field debt: prefer explicit balance-sheet aggregates only.
    // Footnote notes carrying amounts are mapped separately to notes_carrying_amount.
    tags: [
      "LongTermDebt",
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligations",
      "ShortTermBorrowings",
      "DebtCurrent",
      "Borrowings",
      "LongtermBorrowings",
    ],
    unit: "USD",
  },
  {
    key: "shares_outstanding",
    label: "Shares outstanding",
    statement: "balance",
    valueType: "instant",
    tags: [
      "EntityCommonStockSharesOutstanding",
      "CommonStockSharesOutstanding",
      "CommonStockSharesIssued",
      "NumberOfSharesOutstanding",
      "OrdinaryShares",
    ],
    unit: "shares",
  },

  // ---------------------------------------------------------------------------
  // Additional direct SEC metrics (sourced from facts.us-gaap unless noted).
  // Each flows through the same extraction pipeline, so provenance
  // (xbrlTagUsed, filingDate, accessionNumber, fiscalPeriod, fiscalYear,
  // sourceForm) is preserved automatically via metricSources.
  // ---------------------------------------------------------------------------

  // --- Balance sheet (instant) ---
  {
    key: "current_assets",
    label: "Current assets",
    statement: "balance",
    valueType: "instant",
    tags: ["AssetsCurrent", "CurrentAssets"],
    unit: "USD",
  },
  {
    key: "current_liabilities",
    label: "Current liabilities",
    statement: "balance",
    valueType: "instant",
    tags: ["LiabilitiesCurrent", "CurrentLiabilities"],
    unit: "USD",
  },
  {
    key: "long_term_debt",
    label: "Long-term debt",
    statement: "balance",
    valueType: "instant",
    // Noncurrent balance-sheet debt first. Bare LongTermDebt is a last-resort
    // fallback (often current+noncurrent aggregate) and must not beat Noncurrent.
    tags: [
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligationsNoncurrent",
      "DebtNoncurrent",
      "LongtermBorrowings",
      "LongTermDebt",
      "LongTermDebtAndCapitalLeaseObligations",
    ],
    unit: "USD",
  },
  {
    // Current portion of interest-bearing debt (term debt current, then short-term).
    key: "current_debt",
    label: "Current debt",
    statement: "balance",
    valueType: "instant",
    tags: [
      "LongTermDebtCurrent",
      "LongTermDebtAndCapitalLeaseObligationsCurrent",
      "DebtCurrent",
      "CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
      "ShortTermBorrowings",
      "ShorttermBorrowings",
      "ShortTermDebt",
    ],
    unit: "USD",
  },
  {
    key: "commercial_paper",
    label: "Commercial paper",
    statement: "balance",
    valueType: "instant",
    tags: ["CommercialPaper", "CommercialPaperCurrent"],
    unit: "USD",
  },
  {
    // Footnote / debt-instrument disclosure — NOT used for Total debt.
    key: "notes_carrying_amount",
    label: "Notes carrying amount",
    statement: "balance",
    valueType: "instant",
    tags: ["DebtInstrumentCarryingAmount"],
    unit: "USD",
  },
  {
    key: "inventory",
    label: "Inventory",
    statement: "balance",
    valueType: "instant",
    tags: ["InventoryNet", "InventoryFinishedGoods", "InventoryGross", "Inventories", "InventoriesTotal"],
    unit: "USD",
  },
  {
    key: "accounts_receivable",
    label: "Accounts receivable",
    statement: "balance",
    valueType: "instant",
    tags: [
      "AccountsReceivableNetCurrent",
      "ReceivablesNetCurrent",
      "TradeAndOtherCurrentReceivables",
      "CurrentTradeReceivables",
    ],
    unit: "USD",
  },
  {
    key: "property_plant_equipment",
    label: "Property, plant & equipment",
    statement: "balance",
    valueType: "instant",
    tags: ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipment"],
    unit: "USD",
  },
  {
    key: "goodwill",
    label: "Goodwill",
    statement: "balance",
    valueType: "instant",
    tags: ["Goodwill"],
    unit: "USD",
  },

  // --- Income statement (duration) ---
  {
    key: "research_and_development_expense",
    label: "R&D expense",
    statement: "income",
    valueType: "duration",
    tags: ["ResearchAndDevelopmentExpense"],
    unit: "USD",
  },
  {
    key: "selling_general_administrative_expense",
    label: "SG&A expense",
    statement: "income",
    valueType: "duration",
    tags: [
      "SellingGeneralAndAdministrativeExpense",
      // Biotech / R&D-heavy filers often report G&A separately without an SG&A rollup.
      "GeneralAndAdministrativeExpense",
      "AdministrativeExpense",
    ],
    unit: "USD",
  },
  {
    key: "interest_expense",
    label: "Interest expense",
    statement: "income",
    valueType: "duration",
    tags: [
      "InterestExpense",
      "InterestExpenseAndDebtExpense",
      "InterestExpenseDebt",
      "FinanceCosts",
    ],
    unit: "USD",
  },
  {
    key: "income_tax_expense",
    label: "Income tax expense",
    statement: "income",
    valueType: "duration",
    tags: ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"],
    unit: "USD",
  },
  {
    key: "weighted_average_diluted_shares",
    label: "Weighted avg diluted shares",
    statement: "income",
    valueType: "duration",
    tags: [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfShareOutstandingDiluted",
      "AdjustedWeightedAverageShares",
      "WeightedAverageShares",
    ],
    unit: "shares",
  },

  // --- Cash flow (duration) ---
  {
    key: "investing_cash_flow",
    label: "Investing cash flow",
    statement: "cashflow",
    valueType: "duration",
    tags: [
      "NetCashProvidedByUsedInInvestingActivities",
      "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations",
      "CashFlowsFromUsedInInvestingActivities",
    ],
    unit: "USD",
  },
  {
    key: "financing_cash_flow",
    label: "Financing cash flow",
    statement: "cashflow",
    valueType: "duration",
    tags: [
      "NetCashProvidedByUsedInFinancingActivities",
      "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
      "CashFlowsFromUsedInFinancingActivities",
    ],
    unit: "USD",
  },
  {
    key: "dividends_paid",
    label: "Dividends paid",
    statement: "cashflow",
    valueType: "duration",
    tags: [
      "PaymentsOfDividends",
      "DividendsPaid",
      "PaymentsOfDividendsCommonStock",
      "DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities",
    ],
    unit: "USD",
  },
  {
    key: "share_repurchases",
    label: "Share repurchases",
    statement: "cashflow",
    valueType: "duration",
    tags: [
      "PaymentsForRepurchaseOfCommonStock",
      "PaymentsToAcquireTreasuryStock",
      "PaymentsToAcquireOrRedeemEntitysShares",
      "PurchaseOfTreasuryShares",
    ],
    unit: "USD",
  },
  {
    // Internal helper for the EBITDA derived metric.
    key: "depreciation_amortization",
    label: "Depreciation & amortization",
    statement: "cashflow",
    valueType: "duration",
    tags: [
      "DepreciationDepletionAndAmortization",
      "Depreciation",
      "DepreciationAmortizationAndAccretionNet",
      "DepreciationAndAmortisationExpense",
      "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
    ],
    unit: "USD",
  },
];

export const FINANCIAL_METRIC_KEYS: FinancialMetricKey[] = FINANCIAL_METRIC_DEFINITIONS.map(
  (d) => d.key
);

export const FINANCIAL_METRIC_BY_KEY = Object.fromEntries(
  FINANCIAL_METRIC_DEFINITIONS.map((d) => [d.key, d])
) as Record<FinancialMetricKey, FinancialMetricDefinition>;

export const METRICS_BY_STATEMENT: Record<StatementSection, FinancialMetricDefinition[]> = {
  income: FINANCIAL_METRIC_DEFINITIONS.filter((d) => d.statement === "income"),
  balance: FINANCIAL_METRIC_DEFINITIONS.filter((d) => d.statement === "balance"),
  cashflow: FINANCIAL_METRIC_DEFINITIONS.filter((d) => d.statement === "cashflow"),
};

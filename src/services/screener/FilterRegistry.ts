/**
 * The filter registry: the ONE place every screener filter is declared.
 *
 * To add a new filter, append a {@link FilterDefinition} here. The parser,
 * query builder, post-filter evaluators, API, and UI all derive their behaviour
 * from these definitions — no filter logic is hardcoded anywhere else.
 */
import type {
  FilterDefinition,
  FilterOperator,
  FilterValue,
} from "./FilterTypes.js";

const NUMERIC_OPS: FilterOperator[] = ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "equals"];

function requirePositiveNumber(value: FilterValue): string | null {
  return typeof value === "number" && Number.isFinite(value) ? null : "Expected a numeric value";
}

export const FILTER_DEFINITIONS: readonly FilterDefinition[] = [
  // ----------------------------------------------------------------------------
  // 4. Company Basics  (SQL: stocks + latest fundamentals)
  // ----------------------------------------------------------------------------
  {
    id: "sector",
    label: "Sector",
    category: "Company Basics",
    field: "sector",
    type: "enum",
    operators: ["equals", "notEquals", "in"],
    source: "company",
    dynamicOptions: "sectors",
    sql: { column: "st.sector", valueType: "text" },
  },
  {
    id: "industry",
    label: "Industry",
    category: "Company Basics",
    field: "industry",
    type: "string",
    operators: ["equals", "contains", "in"],
    source: "company",
    dynamicOptions: "industries",
    sql: { column: "st.industry", valueType: "text" },
  },
  {
    id: "revenue",
    label: "Revenue",
    category: "Company Basics",
    field: "revenue",
    type: "number",
    operators: NUMERIC_OPS,
    source: "company",
    unit: "usd",
    sql: { column: "fund.revenue", valueType: "number" },
    validate: requirePositiveNumber,
  },
  {
    id: "freeCashFlow",
    label: "Free Cash Flow",
    category: "Company Basics",
    field: "freeCashFlow",
    type: "number",
    operators: NUMERIC_OPS,
    source: "company",
    unit: "usd",
    sql: { column: "fund.free_cash_flow", valueType: "number" },
    validate: requirePositiveNumber,
  },

  // ----------------------------------------------------------------------------
  // 1. Insider Trading  (SQL: insider_transaction aggregated per ticker)
  // ----------------------------------------------------------------------------
  {
    id: "insiderBuying",
    label: "Insider Buying",
    category: "Insider Trading",
    field: "insiderBuying",
    type: "boolean",
    operators: ["isTrue"],
    source: "insider",
    sql: { column: "((COALESCE(ins.buy_value,0) - COALESCE(ins.sell_value,0)) > 0)", valueType: "boolean" },
  },
  {
    id: "insiderSelling",
    label: "Insider Selling",
    category: "Insider Trading",
    field: "insiderSelling",
    type: "boolean",
    operators: ["isTrue"],
    source: "insider",
    sql: { column: "((COALESCE(ins.sell_value,0) - COALESCE(ins.buy_value,0)) > 0)", valueType: "boolean" },
  },
  {
    id: "netInsiderBuyAmount",
    label: "Net Insider Buying Amount",
    category: "Insider Trading",
    field: "netInsiderBuyAmount",
    type: "number",
    operators: ["greaterThan", "greaterThanOrEqual"],
    source: "insider",
    unit: "usd",
    sql: { column: "(COALESCE(ins.buy_value,0) - COALESCE(ins.sell_value,0))", valueType: "number" },
    validate: requirePositiveNumber,
  },
  {
    id: "netInsiderSellAmount",
    label: "Net Insider Selling Amount",
    category: "Insider Trading",
    field: "netInsiderSellAmount",
    type: "number",
    operators: ["greaterThan", "greaterThanOrEqual"],
    source: "insider",
    unit: "usd",
    sql: { column: "(COALESCE(ins.sell_value,0) - COALESCE(ins.buy_value,0))", valueType: "number" },
    validate: requirePositiveNumber,
  },
  {
    id: "insiderPosition",
    label: "Insider Position",
    category: "Insider Trading",
    field: "insiderPosition",
    type: "enum",
    operators: ["equals", "in"],
    source: "insider",
    options: [
      { value: "CEO", label: "CEO" },
      { value: "CFO", label: "CFO" },
      { value: "Director", label: "Director" },
      { value: "Chairman", label: "Chairman" },
      { value: "Officer", label: "Officer" },
      { value: "VP", label: "VP" },
      { value: "TenPercentOwner", label: "10% Owner" },
    ],
    sql: {
      column: "false",
      enumColumns: {
        CEO: "ins.has_ceo",
        CFO: "ins.has_cfo",
        Director: "ins.has_director",
        Chairman: "ins.has_chairman",
        Officer: "ins.has_officer",
        VP: "ins.has_vp",
        TenPercentOwner: "ins.has_ten_pct",
      },
    },
  },
  {
    id: "transactionType",
    label: "Transaction Type",
    category: "Insider Trading",
    field: "transactionType",
    type: "enum",
    operators: ["equals", "in"],
    source: "insider",
    options: [
      { value: "OpenMarketBuy", label: "Open Market Buy" },
      { value: "OpenMarketSell", label: "Open Market Sell" },
      { value: "OptionExercise", label: "Option Exercise" },
      { value: "Grant", label: "Grant" },
      { value: "Gift", label: "Gift" },
    ],
    sql: {
      column: "false",
      enumColumns: {
        OpenMarketBuy: "ins.has_open_buy",
        OpenMarketSell: "ins.has_open_sell",
        OptionExercise: "ins.has_option_exercise",
        Grant: "ins.has_grant",
        Gift: "ins.has_gift",
      },
    },
  },
  {
    id: "numberOfInsiders",
    label: "Number of Insiders",
    category: "Insider Trading",
    field: "numberOfInsiders",
    type: "number",
    operators: ["greaterThanOrEqual", "greaterThan", "equals"],
    source: "insider",
    unit: "count",
    sql: { column: "COALESCE(ins.insider_count,0)", valueType: "number" },
    validate: requirePositiveNumber,
  },

  // ----------------------------------------------------------------------------
  // 3. Institutional Ownership  (post-filter over tracked 13F holdings)
  // ----------------------------------------------------------------------------
  {
    id: "ownershipTrend",
    label: "Ownership Trend",
    category: "Institutional Ownership",
    field: "ownershipTrend",
    type: "enum",
    operators: ["equals"],
    source: "institutional",
    options: [
      { value: "increasing", label: "Increasing" },
      { value: "decreasing", label: "Decreasing" },
      { value: "neutral", label: "Neutral" },
    ],
    sql: { column: "oc.ownership_trend", valueType: "text" },
  },
  {
    id: "institutionCount",
    label: "Institutions Holding",
    category: "Institutional Ownership",
    field: "institutionCount",
    type: "number",
    operators: ["greaterThanOrEqual", "greaterThan", "lessThan", "equals"],
    source: "institutional",
    unit: "count",
    sql: { column: "COALESCE(oc.institution_count, 0)", valueType: "number" },
    validate: requirePositiveNumber,
  },
  {
    id: "heldByInstitution",
    label: "Held by Institution",
    category: "Institutional Ownership",
    field: "heldByInstitution",
    type: "institution",
    operators: ["equals", "in"],
    source: "institutional",
    dynamicOptions: "institutions",
    sql: { column: "", existsHolding: true },
  },
  {
    id: "institutionType",
    label: "Institution Type",
    category: "Institutional Ownership",
    field: "institutionType",
    type: "enum",
    operators: ["equals", "in"],
    source: "institutional",
    options: [
      { value: "Asset Manager", label: "Asset Manager" },
      { value: "Hedge Fund", label: "Hedge Fund" },
      { value: "Quant Fund", label: "Quant Fund" },
      { value: "Pension Fund", label: "Pension Fund" },
      { value: "Mutual Fund", label: "Mutual Fund" },
      { value: "ETF Provider", label: "ETF Provider" },
      { value: "Sovereign Wealth Fund", label: "Sovereign Wealth Fund" },
      { value: "Insurance Company", label: "Insurance Company" },
      { value: "Family Office", label: "Family Office" },
      { value: "Other", label: "Other" },
    ],
    sql: { column: "oc.institution_types", arrayColumn: "oc.institution_types" },
  },
  {
    id: "institutionalOwnershipPct",
    label: "Institutional Ownership %",
    category: "Institutional Ownership",
    field: "institutionalOwnershipPct",
    type: "number",
    operators: ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"],
    source: "institutional",
    unit: "percent",
    sql: { column: "oc.institutional_ownership_pct", valueType: "number" },
    validate: requirePositiveNumber,
  },
  {
    id: "insiderOwnershipPct",
    label: "Insider Ownership %",
    category: "Institutional Ownership",
    field: "insiderOwnershipPct",
    type: "number",
    operators: ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"],
    source: "institutional",
    unit: "percent",
    sql: { column: "oc.insider_ownership_pct", valueType: "number" },
    validate: requirePositiveNumber,
  },

  // ----------------------------------------------------------------------------
  // 2. Politician Trading  (post-filter over congressional PTR cache)
  // ----------------------------------------------------------------------------
  {
    id: "politicianBuying",
    label: "Politician Buying",
    category: "Politician Trading",
    field: "politicianBuying",
    type: "boolean",
    operators: ["isTrue"],
    source: "politician",
  },
  {
    id: "politicianSelling",
    label: "Politician Selling",
    category: "Politician Trading",
    field: "politicianSelling",
    type: "boolean",
    operators: ["isTrue"],
    source: "politician",
  },
  {
    id: "politicianDollarAmount",
    label: "Politician Dollar Amount",
    category: "Politician Trading",
    field: "politicianDollarAmount",
    type: "number",
    operators: ["greaterThan", "lessThan"],
    source: "politician",
    unit: "usd",
    validate: requirePositiveNumber,
  },
  {
    id: "chamber",
    label: "Chamber",
    category: "Politician Trading",
    field: "chamber",
    type: "enum",
    operators: ["equals", "in"],
    source: "politician",
    options: [
      { value: "senate", label: "Senate" },
      { value: "house", label: "House" },
    ],
  },
  {
    id: "politicianPeriod",
    label: "Time Period",
    category: "Politician Trading",
    field: "politicianPeriod",
    type: "enum",
    operators: ["equals"],
    source: "politician",
    defaultValue: "last90",
    options: [
      { value: "last7", label: "Last 7 days" },
      { value: "last30", label: "Last 30 days" },
      { value: "last90", label: "Last 90 days" },
    ],
  },
  {
    id: "politicianDateRange",
    label: "Custom Date Range",
    category: "Politician Trading",
    field: "politicianDateRange",
    type: "dateRange",
    operators: ["between"],
    source: "politician",
  },
];

const BY_ID = new Map<string, FilterDefinition>();
const BY_FIELD = new Map<string, FilterDefinition>();
for (const def of FILTER_DEFINITIONS) {
  BY_ID.set(def.id, def);
  BY_FIELD.set(def.field, def);
}

export function getFilterDefinition(fieldOrId: string): FilterDefinition | undefined {
  return BY_FIELD.get(fieldOrId) ?? BY_ID.get(fieldOrId);
}

export function listFilterDefinitions(): readonly FilterDefinition[] {
  return FILTER_DEFINITIONS;
}

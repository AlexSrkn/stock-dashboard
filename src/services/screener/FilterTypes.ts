/**
 * Type system for the stock screener.
 *
 * Every filter the UI can apply is described by a {@link FilterDefinition} held in
 * the central registry (see `FilterRegistry.ts`). A definition declares its data
 * `source`, the value `type`, the allowed `operators`, and how it is applied
 * (translated to SQL, or evaluated as a typed post-filter). Nothing about filters
 * is hardcoded outside the registry — adding a new filter is a single definition.
 */

/** Canonical comparison operators. Symbol aliases ("<", ">", "=") are normalized by the parser. */
export type FilterOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "contains"
  | "in"
  | "between"
  | "isTrue";

/** Value shape a filter accepts. */
export type FilterValueType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "date"
  | "dateRange"
  | "institution";

/** Top-level grouping shown in the UI. */
export type FilterCategory =
  | "Insider Trading"
  | "Politician Trading"
  | "Institutional Ownership"
  | "Company Basics";

/**
 * Which engine resolves a filter:
 * - `company` / `insider`  → translated to SQL by {@link QueryBuilder}
 * - `institutional` / `politician` → evaluated as typed post-filters over data
 *   sources that are not (cleanly) queryable in SQL in this codebase.
 */
export type FilterSource = "company" | "insider" | "institutional" | "politician";

export interface FilterOption {
  value: string;
  label: string;
  /** Optional grouping hint (e.g. institution type). */
  meta?: string;
}

/** A concrete date range used by `between` on `dateRange` filters. */
export interface DateRangeValue {
  from: string; // ISO yyyy-mm-dd
  to: string; // ISO yyyy-mm-dd
}

export type FilterValue =
  | string
  | number
  | boolean
  | string[]
  | DateRangeValue;

/**
 * SQL binding for `company` / `insider` filters.
 * `column` is a SQL boolean/numeric/text expression already scoped to the base query
 * aliases (`st`, `fund`, `ins`). `enumColumns` maps enum values to boolean columns
 * (used for insider position / transaction-type flags).
 */
export interface FilterSqlBinding {
  column: string;
  valueType?: "number" | "text" | "boolean";
  enumColumns?: Record<string, string>;
  /** text[] column tested for membership (e.g. `oc.institution_types`). */
  arrayColumn?: string;
  /** Held-by lookup: EXISTS against ownership_holding by institution CIK. */
  existsHolding?: boolean;
}

export interface FilterDefinition {
  id: string;
  label: string;
  category: FilterCategory;
  /** Canonical field name sent by the client (defaults to `id`). */
  field: string;
  type: FilterValueType;
  operators: FilterOperator[];
  source: FilterSource;
  description?: string;
  defaultValue?: FilterValue;
  /** Static enum options. `dynamicOptions` (see registry helpers) may augment these. */
  options?: FilterOption[];
  /** Marks options as loaded at runtime (sectors, institutions). */
  dynamicOptions?: "sectors" | "industries" | "institutions";
  unit?: "usd" | "percent" | "count";
  /** SQL binding for company/insider sources. */
  sql?: FilterSqlBinding;
  /** Best-effort sources may be skipped when data is unavailable; surfaced in meta. */
  bestEffort?: boolean;
  /** Explanation shown when a best-effort filter is skipped. */
  bestEffortReason?: string;
  /** Optional extra validation; returns an error string or null. */
  validate?: (value: FilterValue, operator: FilterOperator) => string | null;
}

/** Raw filter object as received from the client. */
export interface ScreenerFilterInput {
  field: string;
  operator: string;
  value?: unknown;
}

/** A validated filter bound to its definition. */
export interface ParsedFilter {
  definition: FilterDefinition;
  operator: FilterOperator;
  value: FilterValue;
}

export type ScreenerSortDirection = "asc" | "desc";

export interface ScreenerSort {
  field: string;
  direction: ScreenerSortDirection;
}

export interface ScreenerRequest {
  filters: ScreenerFilterInput[];
  limit?: number;
  offset?: number;
  sort?: ScreenerSort;
  /** Trailing window (days) for insider aggregation. Default 180. */
  insiderWindowDays?: number;
}

export interface ScreenerResultRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  revenue: number | null;
  freeCashFlow: number | null;
  /** Populated when insider filters/sources are involved. */
  insiderNetValueUsd?: number | null;
  insiderCount?: number | null;
  /** Ownership-cache fields (precomputed). */
  institutionCount?: number | null;
  institutionalOwnershipPct?: number | null;
  insiderOwnershipPct?: number | null;
  ownershipTrend?: string | null;
  topInstitutions?: Array<{ name: string; shares: number; ownershipPercent: number | null; type: string }>;
  /** Populated when politician filters are involved. */
  politicianNetAmountUsd?: number | null;
}

export interface ScreenerResponse {
  computedAt: string;
  count: number;
  total: number;
  limit: number;
  offset: number;
  appliedFilters: Array<{ field: string; operator: FilterOperator; value: FilterValue }>;
  /** Filters that could not be applied (e.g. unavailable data); transparency for the UI. */
  skippedFilters: Array<{ field: string; reason: string }>;
  dataSources: FilterSource[];
  results: ScreenerResultRow[];
}

/** Thrown for malformed/invalid filter input (maps to HTTP 400). */
export class ScreenerValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ScreenerValidationError";
  }
}

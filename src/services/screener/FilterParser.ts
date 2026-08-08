/**
 * Parses and validates raw client filter objects into typed {@link ParsedFilter}s.
 * All validation lives here and is driven entirely by the registry definitions.
 */
import { getFilterDefinition } from "./FilterRegistry.js";
import {
  ScreenerValidationError,
  type DateRangeValue,
  type FilterDefinition,
  type FilterOperator,
  type FilterValue,
  type ParsedFilter,
  type ScreenerFilterInput,
} from "./FilterTypes.js";

/** Accept symbolic and common aliases, normalizing to canonical operators. */
const OPERATOR_ALIASES: Record<string, FilterOperator> = {
  "=": "equals",
  "==": "equals",
  eq: "equals",
  equals: "equals",
  "!=": "notEquals",
  "<>": "notEquals",
  ne: "notEquals",
  notequals: "notEquals",
  ">": "greaterThan",
  gt: "greaterThan",
  greaterthan: "greaterThan",
  ">=": "greaterThanOrEqual",
  gte: "greaterThanOrEqual",
  greaterthanorequal: "greaterThanOrEqual",
  "<": "lessThan",
  lt: "lessThan",
  lessthan: "lessThan",
  "<=": "lessThanOrEqual",
  lte: "lessThanOrEqual",
  lessthanorequal: "lessThanOrEqual",
  contains: "contains",
  like: "contains",
  in: "in",
  between: "between",
  istrue: "isTrue",
  true: "isTrue",
};

function normalizeOperator(raw: string): FilterOperator | null {
  const key = String(raw || "").trim().toLowerCase();
  return OPERATOR_ALIASES[key] ?? null;
}

function isDateRange(value: unknown): value is DateRangeValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DateRangeValue).from === "string" &&
    typeof (value as DateRangeValue).to === "string"
  );
}

function coerceValue(
  def: FilterDefinition,
  operator: FilterOperator,
  raw: unknown
): FilterValue {
  // Boolean flag filters ignore the value entirely.
  if (operator === "isTrue") return true;

  if (operator === "in") {
    const arr = Array.isArray(raw) ? raw : [raw];
    const list = arr.map((v) => String(v)).filter((v) => v.length > 0);
    if (!list.length) throw new ScreenerValidationError(`Filter "${def.field}" requires a non-empty list for "in"`);
    return list;
  }

  if (operator === "between" || def.type === "dateRange") {
    if (!isDateRange(raw)) {
      throw new ScreenerValidationError(`Filter "${def.field}" requires { from, to } for "between"`);
    }
    return { from: raw.from, to: raw.to };
  }

  switch (def.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        throw new ScreenerValidationError(`Filter "${def.field}" requires a numeric value`);
      }
      return n;
    }
    case "boolean": {
      return Boolean(raw);
    }
    case "enum":
    case "institution":
    case "string":
    default: {
      const s = String(raw ?? "").trim();
      if (!s) throw new ScreenerValidationError(`Filter "${def.field}" requires a value`);
      return s;
    }
  }
}

function validateEnumValue(def: FilterDefinition, value: FilterValue): void {
  if (def.type !== "enum" || !def.options?.length) return;
  const allowed = new Set(def.options.map((o) => o.value));
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    if (!allowed.has(String(v))) {
      throw new ScreenerValidationError(
        `Filter "${def.field}" got invalid value "${v}". Allowed: ${[...allowed].join(", ")}`
      );
    }
  }
}

export function parseFilters(rawFilters: unknown): ParsedFilter[] {
  if (rawFilters == null) return [];
  if (!Array.isArray(rawFilters)) {
    throw new ScreenerValidationError("`filters` must be an array");
  }

  const parsed: ParsedFilter[] = [];
  for (const item of rawFilters as ScreenerFilterInput[]) {
    if (!item || typeof item !== "object") {
      throw new ScreenerValidationError("Each filter must be an object { field, operator, value }");
    }
    const field = String(item.field || "").trim();
    if (!field) throw new ScreenerValidationError("Filter is missing `field`");

    const def = getFilterDefinition(field);
    if (!def) throw new ScreenerValidationError(`Unknown filter field "${field}"`);

    const operator = normalizeOperator(item.operator);
    if (!operator) {
      throw new ScreenerValidationError(`Unknown operator "${item.operator}" for field "${field}"`);
    }
    if (!def.operators.includes(operator)) {
      throw new ScreenerValidationError(
        `Operator "${operator}" not allowed for "${field}". Allowed: ${def.operators.join(", ")}`
      );
    }

    const value = coerceValue(def, operator, item.value);
    validateEnumValue(def, value);

    const customError = def.validate?.(value, operator);
    if (customError) {
      throw new ScreenerValidationError(`Filter "${field}": ${customError}`);
    }

    parsed.push({ definition: def, operator, value });
  }

  return parsed;
}

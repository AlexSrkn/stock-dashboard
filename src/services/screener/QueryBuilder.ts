/**
 * Translates `company` and `insider` source filters into a single parameterized
 * SQL query over `stocks` + latest fundamentals + a per-ticker insider aggregate.
 *
 * Institutional and politician filters are NOT handled here — they are applied as
 * typed post-filters by {@link ScreenerService} because their underlying data is
 * not cleanly ticker-keyed in SQL in this codebase.
 */
import type {
  FilterOperator,
  ParsedFilter,
  ScreenerSort,
} from "./FilterTypes.js";

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

const COMPARISON_SQL: Partial<Record<FilterOperator, string>> = {
  equals: "=",
  notEquals: "<>",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
};

/** Whitelisted sortable expressions (prevents SQL injection via sort.field). */
const SORTABLE: Record<string, string> = {
  revenue: "fund.revenue",
  freeCashFlow: "fund.free_cash_flow",
  netInsiderBuyAmount: "insider_net_value",
  numberOfInsiders: "ins.insider_count",
  ticker: "st.ticker",
};

const BASE_CTE = `
latest_period AS (
  SELECT DISTINCT ON (UPPER(BTRIM(ticker)))
    UPPER(BTRIM(ticker)) AS ticker,
    metrics,
    derived_metrics
  FROM sec_financial_period
  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''
  ORDER BY UPPER(BTRIM(ticker)), period_end DESC,
    CASE statement_scope WHEN 'quarterly' THEN 0 ELSE 1 END,
    filed_date DESC
),
fund AS (
  SELECT
    ticker,
    (metrics->>'revenue')::float8 AS revenue,
    COALESCE(
      (derived_metrics->>'free_cash_flow')::float8,
      CASE
        WHEN (metrics->>'operating_cash_flow') IS NOT NULL
          AND (metrics->>'capital_expenditures') IS NOT NULL
        THEN (metrics->>'operating_cash_flow')::float8
          - ABS((metrics->>'capital_expenditures')::float8)
      END
    ) AS free_cash_flow
  FROM latest_period
),
ins AS (
  SELECT
    UPPER(BTRIM(ticker)) AS ticker,
    SUM(CASE WHEN UPPER(transaction_code) = 'P' THEN COALESCE(transaction_value, 0) ELSE 0 END) AS buy_value,
    SUM(CASE WHEN UPPER(transaction_code) = 'S' THEN COALESCE(transaction_value, 0) ELSE 0 END) AS sell_value,
    COUNT(DISTINCT insider_name) AS insider_count,
    bool_or(insider_title ILIKE '%CEO%' OR insider_title ILIKE '%chief executive%') AS has_ceo,
    bool_or(insider_title ILIKE '%CFO%' OR insider_title ILIKE '%chief financial%') AS has_cfo,
    bool_or(insider_title ILIKE '%director%') AS has_director,
    bool_or(insider_title ILIKE '%chair%') AS has_chairman,
    bool_or(insider_title ILIKE '%officer%' OR insider_title ILIKE '%president%' OR insider_title ILIKE '%chief%') AS has_officer,
    bool_or(insider_title ILIKE '%vice president%' OR insider_title ILIKE '%VP%') AS has_vp,
    bool_or(insider_title ILIKE '%10%' AND insider_title ILIKE '%owner%') AS has_ten_pct,
    bool_or(UPPER(transaction_code) = 'P') AS has_open_buy,
    bool_or(UPPER(transaction_code) = 'S') AS has_open_sell,
    bool_or(UPPER(transaction_code) = 'M') AS has_option_exercise,
    bool_or(UPPER(transaction_code) = 'A') AS has_grant,
    bool_or(UPPER(transaction_code) = 'G') AS has_gift
  FROM insider_transaction
  WHERE ticker IS NOT NULL AND BTRIM(ticker) <> ''
    AND transaction_date >= CURRENT_DATE - make_interval(days => $WINDOW$::int)
  GROUP BY UPPER(BTRIM(ticker))
)
`.trim();

function buildSort(sort?: ScreenerSort): string {
  const expr = sort && SORTABLE[sort.field] ? SORTABLE[sort.field] : "fund.revenue";
  const dir = sort?.direction === "asc" ? "ASC" : "DESC";
  return `${expr} ${dir} NULLS LAST, st.ticker ASC`;
}

/** Builds shared WHERE conditions + params (window is always $1). */
function buildConditions(filters: ParsedFilter[]): { whereSql: string; params: unknown[]; windowIdx: number } {
  const params: unknown[] = [];
  params.push(0); // placeholder for window; filled by caller before use
  const windowIdx = 1;
  const conditions: string[] = [];

  for (const filter of filters) {
    const def = filter.definition;
    const sqlSource =
      def.source === "company" || def.source === "insider" || def.source === "institutional";
    if (!sqlSource || !def.sql) continue;
    const { column, enumColumns, arrayColumn, existsHolding } = def.sql;

    // Held-by-institution: indexed EXISTS against the ownership_holding cache (by CIK).
    if (existsHolding) {
      const list = Array.isArray(filter.value) ? filter.value : [String(filter.value)];
      params.push(list);
      conditions.push(
        `EXISTS (SELECT 1 FROM ownership_holding oh
           WHERE oh.ticker = UPPER(BTRIM(st.ticker))
             AND oh.institution_cik = ANY($${params.length}::char(10)[]))`
      );
      continue;
    }

    // Institution type: membership against the cached text[] of holder types.
    if (arrayColumn) {
      const list = Array.isArray(filter.value) ? filter.value : [String(filter.value)];
      params.push(list);
      conditions.push(`${arrayColumn} && $${params.length}::text[]`);
      continue;
    }

    if (filter.operator === "isTrue") {
      conditions.push(`(${column})`);
      continue;
    }

    if (enumColumns) {
      const values = Array.isArray(filter.value) ? filter.value : [String(filter.value)];
      const cols = values
        .map((v) => enumColumns[String(v)])
        .filter((c): c is string => Boolean(c));
      if (cols.length) conditions.push(`(${cols.map((c) => `COALESCE(${c}, false)`).join(" OR ")})`);
      continue;
    }

    if (filter.operator === "in") {
      const list = Array.isArray(filter.value) ? filter.value : [String(filter.value)];
      params.push(list);
      conditions.push(`${column} = ANY($${params.length}::text[])`);
      continue;
    }

    if (filter.operator === "contains") {
      params.push(`%${String(filter.value)}%`);
      conditions.push(`${column} ILIKE $${params.length}`);
      continue;
    }

    const op = COMPARISON_SQL[filter.operator];
    if (!op) continue;
    params.push(filter.value);
    conditions.push(`${column} ${op} $${params.length}`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join("\n    AND ")}` : "";
  return { whereSql, params, windowIdx };
}

export function buildScreenerQuery(
  filters: ParsedFilter[],
  opts: { limit: number; offset: number; insiderWindowDays: number; sort?: ScreenerSort }
): BuiltQuery {
  const { whereSql, params, windowIdx } = buildConditions(filters);
  params[0] = Math.max(1, Math.round(opts.insiderWindowDays));

  params.push(opts.limit);
  const limitIdx = params.length;
  params.push(opts.offset);
  const offsetIdx = params.length;

  const sql = `
WITH ${BASE_CTE.replace("$WINDOW$", () => `$${windowIdx}`)}
SELECT
  st.ticker,
  st.company_name,
  st.sector,
  st.industry,
  fund.revenue,
  fund.free_cash_flow,
  (COALESCE(ins.buy_value, 0) - COALESCE(ins.sell_value, 0)) AS insider_net_value,
  ins.insider_count,
  oc.institution_count,
  oc.institutional_ownership_pct,
  oc.insider_ownership_pct,
  oc.ownership_trend,
  oc.top_institutions
FROM stocks st
LEFT JOIN fund ON fund.ticker = UPPER(BTRIM(st.ticker))
LEFT JOIN ins ON ins.ticker = UPPER(BTRIM(st.ticker))
LEFT JOIN ownership_cache oc ON oc.ticker = UPPER(BTRIM(st.ticker))
${whereSql}
ORDER BY ${buildSort(opts.sort)}
LIMIT $${limitIdx} OFFSET $${offsetIdx}
`.trim();

  return { sql, params };
}

export function buildScreenerCountQuery(
  filters: ParsedFilter[],
  opts: { insiderWindowDays: number }
): BuiltQuery {
  const { whereSql, params, windowIdx } = buildConditions(filters);
  params[0] = Math.max(1, Math.round(opts.insiderWindowDays));

  const sql = `
WITH ${BASE_CTE.replace("$WINDOW$", () => `$${windowIdx}`)}
SELECT COUNT(*)::int AS total
FROM stocks st
LEFT JOIN fund ON fund.ticker = UPPER(BTRIM(st.ticker))
LEFT JOIN ins ON ins.ticker = UPPER(BTRIM(st.ticker))
LEFT JOIN ownership_cache oc ON oc.ticker = UPPER(BTRIM(st.ticker))
${whereSql}
`.trim();

  return { sql, params };
}

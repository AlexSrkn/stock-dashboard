/**
 * Orchestrates a screener run:
 *   1. Parse + validate filters (registry-driven).
 *   2. Translate `company` / `insider` / `institutional` filters to SQL and fetch
 *      a candidate set. Institutional filters hit ONLY the precomputed ownership
 *      cache (indexed lookups) — never raw 13F tables.
 *   3. Apply `politician` filters as typed post-filters (PTR data is a JSON cache).
 *   4. Sort/paginate and report applied vs skipped filters.
 */
import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { parseFilters } from "./FilterParser.js";
import { buildScreenerCountQuery, buildScreenerQuery } from "./QueryBuilder.js";
import {
  buildPoliticianIndex,
  evaluatePoliticianFilter,
  resolvePoliticianWindow,
} from "./politicianIndex.js";
import type {
  FilterSource,
  ParsedFilter,
  ScreenerRequest,
  ScreenerResponse,
  ScreenerResultRow,
} from "./FilterTypes.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const POST_FILTER_CANDIDATE_CAP = 5000;
const DEFAULT_INSIDER_WINDOW_DAYS = 180;

interface TopInstitutionJson {
  name?: string;
  shares?: number;
  ownershipPercent?: number | null;
  type?: string;
}

interface RawRow {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  revenue: number | string | null;
  free_cash_flow: number | string | null;
  insider_net_value: number | string | null;
  insider_count: number | string | null;
  institution_count: number | string | null;
  institutional_ownership_pct: number | string | null;
  insider_ownership_pct: number | string | null;
  ownership_trend: string | null;
  top_institutions: TopInstitutionJson[] | string | null;
}

function round2(n: number | string | null | undefined): number | null {
  if (n == null) return null;
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

function parseTopInstitutions(value: RawRow["top_institutions"]): ScreenerResultRow["topInstitutions"] {
  if (!value) return [];
  const arr = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => ({
    name: String(t?.name ?? ""),
    shares: Number(t?.shares ?? 0),
    ownershipPercent: t?.ownershipPercent != null ? Number(t.ownershipPercent) : null,
    type: String(t?.type ?? "Other"),
  }));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

function mapRow(row: RawRow): ScreenerResultRow {
  return {
    ticker: String(row.ticker || "").toUpperCase(),
    companyName: row.company_name ?? null,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    revenue: round2(row.revenue),
    freeCashFlow: round2(row.free_cash_flow),
    insiderNetValueUsd: round2(row.insider_net_value),
    insiderCount: row.insider_count != null ? Number(row.insider_count) : null,
    institutionCount: row.institution_count != null ? Number(row.institution_count) : null,
    institutionalOwnershipPct: round2(row.institutional_ownership_pct),
    insiderOwnershipPct: round2(row.insider_ownership_pct),
    ownershipTrend: row.ownership_trend ?? null,
    topInstitutions: parseTopInstitutions(row.top_institutions),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function runScreener(
  request: ScreenerRequest,
  pool: pg.Pool = getPool()
): Promise<ScreenerResponse> {
  const parsed = parseFilters(request.filters);
  const limit = clamp(Math.round(request.limit ?? DEFAULT_LIMIT), 1, MAX_LIMIT);
  const offset = Math.max(0, Math.round(request.offset ?? 0));
  const insiderWindowDays = clamp(
    Math.round(request.insiderWindowDays ?? DEFAULT_INSIDER_WINDOW_DAYS),
    1,
    1825
  );

  // SQL handles company + insider + institutional (the latter via the ownership cache).
  const sqlFilters = parsed.filter((f) => f.definition.source !== "politician");
  const politicianFilters = parsed.filter((f) => f.definition.source === "politician");

  const skipped: ScreenerResponse["skippedFilters"] = [];

  // Politician filters that actually exclude rows (period/date-range only scope the window).
  const politicianRowFilters = politicianFilters.filter(
    (f) => f.definition.id !== "politicianPeriod" && f.definition.id !== "politicianDateRange"
  );

  const needPostFilter = politicianRowFilters.length > 0;
  const sqlLimit = needPostFilter ? POST_FILTER_CANDIDATE_CAP : limit;
  const sqlOffset = needPostFilter ? 0 : offset;

  const { sql, params } = buildScreenerQuery(sqlFilters, {
    limit: sqlLimit,
    offset: sqlOffset,
    insiderWindowDays,
    sort: request.sort,
  });
  const res = await pool.query<RawRow>(sql, params);
  let rows = res.rows.map(mapRow);

  // --- Politician post-filter (JSON cache) ---
  if (politicianFilters.length) {
    const window = resolvePoliticianWindow(politicianFilters);
    const index = buildPoliticianIndex(window);
    if (!index.available) {
      for (const f of politicianRowFilters) {
        skipped.push({ field: f.definition.field, reason: "Politician data not loaded. Run: npm run politicians:fetch-recent" });
      }
    } else {
      if (politicianRowFilters.length) {
        rows = rows.filter((row) => {
          const entry = index.byTicker.get(row.ticker);
          return politicianRowFilters.every((f) => evaluatePoliticianFilter(f, entry));
        });
      }
      for (const row of rows) {
        const entry = index.byTicker.get(row.ticker);
        row.politicianNetAmountUsd = entry ? round2(entry.netAmountUsd) : null;
      }
    }
  }

  // --- Total + pagination ---
  let total: number;
  let pageRows: ScreenerResultRow[];
  if (needPostFilter) {
    total = rows.length;
    pageRows = rows.slice(offset, offset + limit);
  } else {
    const countQuery = buildScreenerCountQuery(sqlFilters, { insiderWindowDays });
    const countRes = await pool.query<{ total: number }>(countQuery.sql, countQuery.params);
    total = Number(countRes.rows[0]?.total ?? rows.length);
    pageRows = rows;
  }

  const dataSources = [...new Set(parsed.map((f) => f.definition.source))] as FilterSource[];
  const appliedFilters = parsed
    .filter((f) => !skipped.some((s) => s.field === f.definition.field))
    .map((f: ParsedFilter) => ({ field: f.definition.field, operator: f.operator, value: f.value }));

  return {
    computedAt: new Date().toISOString(),
    count: pageRows.length,
    total,
    limit,
    offset,
    appliedFilters,
    skippedFilters: skipped,
    dataSources,
    results: pageRows,
  };
}

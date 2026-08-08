import type pg from "pg";
import { getPool } from "../db/pool.js";

const MIN_REVENUE_USD = 100_000_000;
const DEFAULT_LIMIT = 200;

export interface FundamentalsRankingRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  sic: string | null;
  sicDescription: string | null;
  periodEnd: string;
  fiscalPeriod: string;
  fiscalYear: number;
  revenue: number | null;
  revenueGrowthYoy: number | null;
  freeCashFlow: number | null;
  operatingMargin: number | null;
}

export interface FundamentalsRankingPayload {
  computedAt: string;
  count: number;
  sector: string | null;
  sectors: string[];
  stocks: FundamentalsRankingRow[];
}

export interface RankingQueryOptions {
  limit?: number;
  sector?: string | null;
}

const LATEST_PERIOD_CTE = `
latest_period AS (
  SELECT DISTINCT ON (UPPER(BTRIM(ticker)))
    UPPER(BTRIM(ticker)) AS ticker,
    period_end,
    fiscal_period,
    fiscal_year,
    metrics,
    derived_metrics
  FROM sec_financial_period
  WHERE ticker IS NOT NULL
    AND BTRIM(ticker) <> ''
  ORDER BY UPPER(BTRIM(ticker)), period_end DESC,
    CASE statement_scope WHEN 'quarterly' THEN 0 ELSE 1 END,
    filed_date DESC
)
`.trim();

function roundMetric(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseSector(sector?: string | null): string | null {
  const value = String(sector || "").trim();
  return value || null;
}

function mapRow(row: {
  ticker: string;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  sic?: string | null;
  sic_description?: string | null;
  period_end: string | Date;
  fiscal_period: string;
  fiscal_year: number;
  revenue: number | null;
  revenue_growth_yoy?: number | null;
  free_cash_flow?: number | null;
  operating_margin?: number | null;
}): FundamentalsRankingRow {
  const periodEnd =
    row.period_end instanceof Date
      ? row.period_end.toISOString().slice(0, 10)
      : String(row.period_end).slice(0, 10);
  return {
    ticker: String(row.ticker || "").toUpperCase(),
    companyName: row.company_name ?? null,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    sic: row.sic ?? null,
    sicDescription: row.sic_description ?? null,
    periodEnd,
    fiscalPeriod: String(row.fiscal_period || ""),
    fiscalYear: Number(row.fiscal_year),
    revenue: row.revenue != null ? roundMetric(Number(row.revenue)) : null,
    revenueGrowthYoy:
      row.revenue_growth_yoy != null ? roundMetric(Number(row.revenue_growth_yoy)) : null,
    freeCashFlow: row.free_cash_flow != null ? roundMetric(Number(row.free_cash_flow)) : null,
    operatingMargin:
      row.operating_margin != null ? roundMetric(Number(row.operating_margin)) : null,
  };
}

async function loadAvailableSectors(pool: pg.Pool): Promise<string[]> {
  const res = await pool.query<{ sector: string }>(
    `SELECT DISTINCT sector
     FROM stocks
     WHERE sector IS NOT NULL AND BTRIM(sector) <> ''
     ORDER BY sector ASC`
  );
  return res.rows.map((r) => r.sector);
}

async function buildPayload(
  pool: pg.Pool,
  stocks: FundamentalsRankingRow[],
  sector: string | null
): Promise<FundamentalsRankingPayload> {
  const sectors = await loadAvailableSectors(pool);
  return {
    computedAt: new Date().toISOString(),
    count: stocks.length,
    sector,
    sectors,
    stocks,
  };
}

export async function loadRevenueGrowthLeaders(
  pool: pg.Pool = getPool(),
  options: RankingQueryOptions = {}
): Promise<FundamentalsRankingPayload> {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const sector = parseSector(options.sector);
  const params: unknown[] = [MIN_REVENUE_USD, limit];
  let sectorFilter = "";
  if (sector) {
    params.push(sector);
    sectorFilter = ` AND st.sector = $${params.length}`;
  }

  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string | null;
    industry: string | null;
    sic: string | null;
    sic_description: string | null;
    period_end: string;
    fiscal_period: string;
    fiscal_year: number;
    revenue: number;
    revenue_growth_yoy: number;
  }>(
    `
    WITH ${LATEST_PERIOD_CTE}
    SELECT
      lp.ticker,
      st.company_name,
      st.sector,
      st.industry,
      st.sic,
      st.sic_description,
      lp.period_end,
      lp.fiscal_period,
      lp.fiscal_year,
      (lp.metrics->>'revenue')::float8 AS revenue,
      (lp.derived_metrics->>'revenue_growth_yoy')::float8 AS revenue_growth_yoy
    FROM latest_period lp
    LEFT JOIN stocks st ON st.ticker = lp.ticker
    WHERE (lp.metrics->>'revenue')::float8 > $1
      AND (lp.derived_metrics->>'revenue_growth_yoy') IS NOT NULL
      ${sectorFilter}
    ORDER BY (lp.derived_metrics->>'revenue_growth_yoy')::float8 DESC NULLS LAST
    LIMIT $2
    `,
    params
  );

  return buildPayload(
    pool,
    res.rows.map((row) =>
      mapRow({
        ...row,
        free_cash_flow: null,
        operating_margin: null,
      })
    ),
    sector
  );
}

export async function loadFreeCashFlowLeaders(
  pool: pg.Pool = getPool(),
  options: RankingQueryOptions = {}
): Promise<FundamentalsRankingPayload> {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const sector = parseSector(options.sector);
  const params: unknown[] = [limit];
  let sectorFilter = "";
  if (sector) {
    params.push(sector);
    sectorFilter = ` AND st.sector = $${params.length}`;
  }

  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string | null;
    industry: string | null;
    sic: string | null;
    sic_description: string | null;
    period_end: string;
    fiscal_period: string;
    fiscal_year: number;
    revenue: number | null;
    free_cash_flow: number;
  }>(
    `
    WITH ${LATEST_PERIOD_CTE},
    with_fcf AS (
      SELECT
        ticker,
        period_end,
        fiscal_period,
        fiscal_year,
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
    )
    SELECT
      w.ticker,
      st.company_name,
      st.sector,
      st.industry,
      st.sic,
      st.sic_description,
      w.period_end,
      w.fiscal_period,
      w.fiscal_year,
      w.revenue,
      w.free_cash_flow
    FROM with_fcf w
    LEFT JOIN stocks st ON st.ticker = w.ticker
    WHERE w.free_cash_flow IS NOT NULL
      ${sectorFilter}
    ORDER BY w.free_cash_flow DESC
    LIMIT $1
    `,
    params
  );

  return buildPayload(
    pool,
    res.rows.map((row) =>
      mapRow({
        ...row,
        revenue_growth_yoy: null,
        operating_margin: null,
      })
    ),
    sector
  );
}

export async function loadHighMarginStocks(
  pool: pg.Pool = getPool(),
  options: RankingQueryOptions = {}
): Promise<FundamentalsRankingPayload> {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const sector = parseSector(options.sector);
  const params: unknown[] = [MIN_REVENUE_USD, limit];
  let sectorFilter = "";
  if (sector) {
    params.push(sector);
    sectorFilter = ` AND st.sector = $${params.length}`;
  }

  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string | null;
    industry: string | null;
    sic: string | null;
    sic_description: string | null;
    period_end: string;
    fiscal_period: string;
    fiscal_year: number;
    revenue: number;
    operating_margin: number;
  }>(
    `
    WITH ${LATEST_PERIOD_CTE},
    with_margin AS (
      SELECT
        ticker,
        period_end,
        fiscal_period,
        fiscal_year,
        (metrics->>'revenue')::float8 AS revenue,
        COALESCE(
          (derived_metrics->>'operating_margin')::float8,
          CASE
            WHEN (metrics->>'revenue')::float8 > 0
              AND (metrics->>'operating_income') IS NOT NULL
            THEN ((metrics->>'operating_income')::float8 / (metrics->>'revenue')::float8) * 100
          END
        ) AS operating_margin
      FROM latest_period
    )
    SELECT
      w.ticker,
      st.company_name,
      st.sector,
      st.industry,
      st.sic,
      st.sic_description,
      w.period_end,
      w.fiscal_period,
      w.fiscal_year,
      w.revenue,
      w.operating_margin
    FROM with_margin w
    LEFT JOIN stocks st ON st.ticker = w.ticker
    WHERE w.revenue > $1
      AND w.operating_margin IS NOT NULL
      ${sectorFilter}
    ORDER BY w.operating_margin DESC
    LIMIT $2
    `,
    params
  );

  return buildPayload(
    pool,
    res.rows.map((row) =>
      mapRow({
        ...row,
        revenue_growth_yoy: null,
        free_cash_flow: null,
      })
    ),
    sector
  );
}

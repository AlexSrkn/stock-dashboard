import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getStocksRepository } from "./stocksRepository.js";
import { latestHoldingQuarters } from "./latestHoldingQuarters.js";

export interface SectorIndustrySummary {
  industry: string;
  stockCount: number;
}

export interface SectorSummaryRow {
  sector: string;
  stockCount: number;
  industries: string[];
  industrySummaries: SectorIndustrySummary[];
}

export interface SectorOwnershipRow {
  sector: string;
  tickerCount: number;
  totalValueUsd: number;
  totalShares: number;
}

export interface SectorFlowRow {
  sector: string;
  tickerCount: number;
  netValueChangeUsd: number;
  netSharesChange: number;
  currentQuarter: string;
  previousQuarter: string | null;
}

const COMMON_STOCK_FILTER = `
  (h.put_call IS NULL OR BTRIM(h.put_call) = '')
`.trim();

/** Resolve ticker when sec_holding.ticker is blank (common after bulk 13F ingest). */
const CUSIP_MAP_CTE = `
cusip_map AS (
  SELECT DISTINCT ON (primary_cusip)
    primary_cusip,
    UPPER(BTRIM(ticker)) AS ticker
  FROM ownership_cache
  WHERE primary_cusip IS NOT NULL
    AND BTRIM(primary_cusip) <> ''
    AND ticker IS NOT NULL
    AND BTRIM(ticker) <> ''
  ORDER BY primary_cusip, institution_count DESC NULLS LAST, ticker
)
`.trim();

const RESOLVED_TICKER_EXPR = `COALESCE(NULLIF(UPPER(BTRIM(h.ticker)), ''), cm.ticker)`;

export async function loadSectorSummaries(
  pool: pg.Pool = getPool()
): Promise<{ computedAt: string; sectors: SectorSummaryRow[] }> {
  await getStocksRepository().ensureSchema();
  const res = await pool.query<{
    sector: string;
    stock_count: string;
    industries: string[] | null;
    industry_summaries: { industry: string; stockCount: number }[] | null;
  }>(
    `WITH industry_counts AS (
       SELECT
         sector,
         industry,
         COUNT(*)::int AS stock_count
       FROM stocks
       WHERE sector IS NOT NULL AND BTRIM(sector) <> ''
         AND industry IS NOT NULL AND BTRIM(industry) <> ''
       GROUP BY sector, industry
     )
     SELECT
       sector,
       SUM(stock_count)::text AS stock_count,
       ARRAY_AGG(industry ORDER BY industry) AS industries,
       json_agg(
         json_build_object('industry', industry, 'stockCount', stock_count)
         ORDER BY industry
       ) AS industry_summaries
     FROM industry_counts
     GROUP BY sector
     ORDER BY sector ASC`
  );

  return {
    computedAt: new Date().toISOString(),
    sectors: res.rows.map((row) => {
      const industrySummaries = (row.industry_summaries || [])
        .map((item) => ({
          industry: String(item.industry || ""),
          stockCount: Number(item.stockCount) || 0,
        }))
        .filter((item) => item.industry);
      return {
        sector: row.sector,
        stockCount: Number(row.stock_count),
        industries: (row.industries || []).filter(Boolean),
        industrySummaries,
      };
    }),
  };
}

async function latestQuarters(pool: pg.Pool): Promise<{ current: string; previous: string | null }> {
  return latestHoldingQuarters(pool);
}

export async function loadInstitutionalSectorOwnership(
  pool: pg.Pool = getPool()
): Promise<{ computedAt: string; quarter: string; sectors: SectorOwnershipRow[] }> {
  await getStocksRepository().ensureSchema();
  const { current } = await latestQuarters(pool);
  if (!current) {
    return { computedAt: new Date().toISOString(), quarter: "", sectors: [] };
  }

  const res = await pool.query<{
    sector: string;
    ticker_count: string;
    total_value_usd: string;
    total_shares: string;
  }>(
    `
    WITH ${CUSIP_MAP_CTE},
    holdings AS (
      SELECT
        ${RESOLVED_TICKER_EXPR} AS ticker,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
        SUM(h.shares)::float8 AS shares
      FROM sec_holding h
      LEFT JOIN cusip_map cm ON cm.primary_cusip = h.cusip
      WHERE h.quarter = $1
        AND ${COMMON_STOCK_FILTER}
        AND ${RESOLVED_TICKER_EXPR} IS NOT NULL
      GROUP BY ${RESOLVED_TICKER_EXPR}
    )
    SELECT
      st.sector,
      COUNT(*)::text AS ticker_count,
      COALESCE(SUM(h.value_usd), 0)::text AS total_value_usd,
      COALESCE(SUM(h.shares), 0)::text AS total_shares
    FROM holdings h
    INNER JOIN stocks st ON st.ticker = h.ticker
    WHERE st.sector IS NOT NULL AND BTRIM(st.sector) <> ''
    GROUP BY st.sector
    ORDER BY COALESCE(SUM(h.value_usd), 0) DESC
    `,
    [current]
  );

  return {
    computedAt: new Date().toISOString(),
    quarter: current,
    sectors: res.rows.map((row) => ({
      sector: row.sector,
      tickerCount: Number(row.ticker_count),
      totalValueUsd: Number(row.total_value_usd),
      totalShares: Number(row.total_shares),
    })),
  };
}

export async function loadInstitutionalSectorFlows(
  pool: pg.Pool = getPool()
): Promise<{
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  sectors: SectorFlowRow[];
}> {
  await getStocksRepository().ensureSchema();
  const { current, previous } = await latestQuarters(pool);
  if (!current || !previous) {
    return {
      computedAt: new Date().toISOString(),
      currentQuarter: current,
      previousQuarter: previous,
      sectors: [],
    };
  }

  const res = await pool.query<{
    sector: string;
    ticker_count: string;
    net_value_change_usd: string;
    net_shares_change: string;
  }>(
    `
    WITH ${CUSIP_MAP_CTE},
    cur AS (
      SELECT
        ${RESOLVED_TICKER_EXPR} AS ticker,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
        SUM(h.shares)::float8 AS shares
      FROM sec_holding h
      LEFT JOIN cusip_map cm ON cm.primary_cusip = h.cusip
      WHERE h.quarter = $1
        AND ${COMMON_STOCK_FILTER}
        AND ${RESOLVED_TICKER_EXPR} IS NOT NULL
      GROUP BY ${RESOLVED_TICKER_EXPR}
    ),
    prev AS (
      SELECT
        ${RESOLVED_TICKER_EXPR} AS ticker,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
        SUM(h.shares)::float8 AS shares
      FROM sec_holding h
      LEFT JOIN cusip_map cm ON cm.primary_cusip = h.cusip
      WHERE h.quarter = $2
        AND ${COMMON_STOCK_FILTER}
        AND ${RESOLVED_TICKER_EXPR} IS NOT NULL
      GROUP BY ${RESOLVED_TICKER_EXPR}
    ),
    merged AS (
      SELECT
        COALESCE(c.ticker, p.ticker) AS ticker,
        COALESCE(c.value_usd, 0) - COALESCE(p.value_usd, 0) AS value_change_usd,
        COALESCE(c.shares, 0) - COALESCE(p.shares, 0) AS shares_change
      FROM cur c
      FULL OUTER JOIN prev p ON p.ticker = c.ticker
    )
    SELECT
      st.sector,
      COUNT(*)::text AS ticker_count,
      COALESCE(SUM(m.value_change_usd), 0)::text AS net_value_change_usd,
      COALESCE(SUM(m.shares_change), 0)::text AS net_shares_change
    FROM merged m
    INNER JOIN stocks st ON st.ticker = m.ticker
    WHERE st.sector IS NOT NULL AND BTRIM(st.sector) <> ''
    GROUP BY st.sector
    ORDER BY COALESCE(SUM(m.value_change_usd), 0) DESC
    `,
    [current, previous]
  );

  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    sectors: res.rows.map((row) => ({
      sector: row.sector,
      tickerCount: Number(row.ticker_count),
      netValueChangeUsd: Number(row.net_value_change_usd),
      netSharesChange: Number(row.net_shares_change),
      currentQuarter: current,
      previousQuarter: previous,
    })),
  };
}

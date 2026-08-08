import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getStocksRepository } from "./stocksRepository.js";

export interface SectorSummaryRow {
  sector: string;
  stockCount: number;
  industries: string[];
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
  AND h.ticker IS NOT NULL
  AND BTRIM(h.ticker) <> ''
`.trim();

export async function loadSectorSummaries(
  pool: pg.Pool = getPool()
): Promise<{ computedAt: string; sectors: SectorSummaryRow[] }> {
  await getStocksRepository().ensureSchema();
  const res = await pool.query<{
    sector: string;
    stock_count: string;
    industries: string[] | null;
  }>(
    `SELECT
      sector,
      COUNT(*)::text AS stock_count,
      ARRAY_AGG(DISTINCT industry ORDER BY industry) FILTER (WHERE industry IS NOT NULL) AS industries
     FROM stocks
     WHERE sector IS NOT NULL AND BTRIM(sector) <> ''
     GROUP BY sector
     ORDER BY sector ASC`
  );

  return {
    computedAt: new Date().toISOString(),
    sectors: res.rows.map((row) => ({
      sector: row.sector,
      stockCount: Number(row.stock_count),
      industries: (row.industries || []).filter(Boolean),
    })),
  };
}

async function latestQuarters(pool: pg.Pool): Promise<{ current: string; previous: string | null }> {
  const res = await pool.query<{ quarter: string }>(
    `SELECT DISTINCT quarter
     FROM sec_holding
     WHERE quarter IS NOT NULL AND BTRIM(quarter) <> ''
     ORDER BY quarter DESC
     LIMIT 2`
  );
  return {
    current: res.rows[0]?.quarter || "",
    previous: res.rows[1]?.quarter || null,
  };
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
    WITH holdings AS (
      SELECT
        UPPER(BTRIM(h.ticker)) AS ticker,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
        SUM(h.shares)::float8 AS shares
      FROM sec_holding h
      WHERE h.quarter = $1
        AND ${COMMON_STOCK_FILTER}
      GROUP BY UPPER(BTRIM(h.ticker))
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
    WITH cur AS (
      SELECT
        UPPER(BTRIM(h.ticker)) AS ticker,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
        SUM(h.shares)::float8 AS shares
      FROM sec_holding h
      WHERE h.quarter = $1 AND ${COMMON_STOCK_FILTER}
      GROUP BY UPPER(BTRIM(h.ticker))
    ),
    prev AS (
      SELECT
        UPPER(BTRIM(h.ticker)) AS ticker,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
        SUM(h.shares)::float8 AS shares
      FROM sec_holding h
      WHERE h.quarter = $2 AND ${COMMON_STOCK_FILTER}
      GROUP BY UPPER(BTRIM(h.ticker))
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

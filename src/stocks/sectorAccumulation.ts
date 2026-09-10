import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getStocksRepository } from "./stocksRepository.js";
import { latestHoldingQuarters } from "./latestHoldingQuarters.js";
import { readSectorDiskCache, writeSectorDiskCache } from "./sectorDiskCache.js";

const DISK_CACHE_VERSION = 1;
const DISK_CACHE_NAME = "accumulation-pair";

const COMMON_STOCK_FILTER = `
  (h.put_call IS NULL OR BTRIM(h.put_call) = '')
`.trim();

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

const CACHE_TTL_MS = 30 * 60 * 1000;

export interface SectorAccumulationRow {
  sector: string;
  sectorSlug: string;
  institutionsBuying: number;
  institutionsOwning: number;
  netValueChangeUsd: number;
  netSharesChange: number;
  currentValueUsd: number;
  previousValueUsd: number;
  percentIncrease: number | null;
  tickerCount: number;
}

export interface IndustryAccumulationRow {
  sector: string;
  sectorSlug: string;
  industry: string;
  industrySlug: string;
  institutionsBuying: number;
  institutionsOwning: number;
  netValueChangeUsd: number;
  netSharesChange: number;
  currentValueUsd: number;
  previousValueUsd: number;
  percentIncrease: number | null;
  tickerCount: number;
}

export interface SectorAccumulationSummary {
  topSector: { sector: string; netValueChangeUsd: number } | null;
  totalInstitutionsBuying: number;
  totalNetValueChangeUsd: number;
  averagePercentIncrease: number | null;
  sectorCount: number;
}

export interface IndustryAccumulationSummary {
  topIndustry: { industry: string; sector: string; netValueChangeUsd: number } | null;
  totalInstitutionsBuying: number;
  totalNetValueChangeUsd: number;
  averagePercentIncrease: number | null;
  industryCount: number;
}

export interface SectorAccumulationPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  summary: SectorAccumulationSummary;
  sectors: SectorAccumulationRow[];
}

export interface IndustryAccumulationPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  summary: IndustryAccumulationSummary;
  industries: IndustryAccumulationRow[];
}

function slug(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pctIncrease(net: number, previous: number): number | null {
  if (!(previous > 0) || !Number.isFinite(net)) return null;
  return Math.round((net / previous) * 10000) / 100;
}

function avgPct(rows: { percentIncrease: number | null }[]): number | null {
  const vals = rows
    .map((r) => r.percentIncrease)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

async function latestQuarters(pool: pg.Pool): Promise<{ current: string; previous: string | null }> {
  return latestHoldingQuarters(pool);
}

const HOLDINGS_PAIR_CTE = `
${CUSIP_MAP_CTE},
cur AS (
  SELECT
    h.filer_cik,
    ${RESOLVED_TICKER_EXPR} AS ticker,
    SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
    SUM(h.shares)::float8 AS shares
  FROM sec_holding h
  LEFT JOIN cusip_map cm ON cm.primary_cusip = h.cusip
  WHERE h.quarter = $1
    AND ${COMMON_STOCK_FILTER}
    AND ${RESOLVED_TICKER_EXPR} IS NOT NULL
    AND h.filer_cik IS NOT NULL
  GROUP BY h.filer_cik, ${RESOLVED_TICKER_EXPR}
),
prev AS (
  SELECT
    h.filer_cik,
    ${RESOLVED_TICKER_EXPR} AS ticker,
    SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd,
    SUM(h.shares)::float8 AS shares
  FROM sec_holding h
  LEFT JOIN cusip_map cm ON cm.primary_cusip = h.cusip
  WHERE h.quarter = $2
    AND ${COMMON_STOCK_FILTER}
    AND ${RESOLVED_TICKER_EXPR} IS NOT NULL
    AND h.filer_cik IS NOT NULL
  GROUP BY h.filer_cik, ${RESOLVED_TICKER_EXPR}
),
merged AS (
  SELECT
    COALESCE(c.filer_cik, p.filer_cik) AS filer_cik,
    COALESCE(c.ticker, p.ticker) AS ticker,
    COALESCE(c.value_usd, 0)::float8 AS cur_value,
    COALESCE(p.value_usd, 0)::float8 AS prev_value,
    COALESCE(c.shares, 0)::float8 AS cur_shares,
    COALESCE(p.shares, 0)::float8 AS prev_shares
  FROM cur c
  FULL OUTER JOIN prev p
    ON p.filer_cik = c.filer_cik AND p.ticker = c.ticker
),
classified AS (
  SELECT
    m.filer_cik,
    m.ticker,
    m.cur_value,
    m.prev_value,
    m.cur_shares,
    m.prev_shares,
    (m.cur_value - m.prev_value) AS value_change,
    (m.cur_shares - m.prev_shares) AS shares_change,
    st.sector,
    st.industry
  FROM merged m
  INNER JOIN stocks st ON st.ticker = m.ticker
  WHERE st.sector IS NOT NULL AND BTRIM(st.sector) <> ''
)
`.trim();

let sectorCache: { at: number; payload: SectorAccumulationPayload } | null = null;
let industryCache: { at: number; payload: IndustryAccumulationPayload } | null = null;
let pairInflight: Promise<{
  sectors: SectorAccumulationPayload;
  industries: IndustryAccumulationPayload;
}> | null = null;

function cacheFresh(at: number): boolean {
  return Date.now() - at < CACHE_TTL_MS;
}

function emptySectorPayload(current: string, previous: string | null): SectorAccumulationPayload {
  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    summary: {
      topSector: null,
      totalInstitutionsBuying: 0,
      totalNetValueChangeUsd: 0,
      averagePercentIncrease: null,
      sectorCount: 0,
    },
    sectors: [],
  };
}

function emptyIndustryPayload(
  current: string,
  previous: string | null
): IndustryAccumulationPayload {
  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    summary: {
      topIndustry: null,
      totalInstitutionsBuying: 0,
      totalNetValueChangeUsd: 0,
      averagePercentIncrease: null,
      industryCount: 0,
    },
    industries: [],
  };
}

function buildSectorPayload(
  current: string,
  previous: string | null,
  rows: Array<{
    sector: string;
    institutions_buying: string | number;
    institutions_owning: string | number;
    net_value_change_usd: string | number;
    net_shares_change: string | number;
    current_value_usd: string | number;
    previous_value_usd: string | number;
    ticker_count: string | number;
  }>
): SectorAccumulationPayload {
  const sectors: SectorAccumulationRow[] = rows.map((row) => {
    const netValueChangeUsd = Number(row.net_value_change_usd) || 0;
    const previousValueUsd = Number(row.previous_value_usd) || 0;
    return {
      sector: row.sector,
      sectorSlug: slug(row.sector),
      institutionsBuying: Number(row.institutions_buying) || 0,
      institutionsOwning: Number(row.institutions_owning) || 0,
      netValueChangeUsd,
      netSharesChange: Number(row.net_shares_change) || 0,
      currentValueUsd: Number(row.current_value_usd) || 0,
      previousValueUsd,
      percentIncrease: pctIncrease(netValueChangeUsd, previousValueUsd),
      tickerCount: Number(row.ticker_count) || 0,
    };
  });
  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    summary: {
      topSector: sectors[0]
        ? { sector: sectors[0].sector, netValueChangeUsd: sectors[0].netValueChangeUsd }
        : null,
      totalInstitutionsBuying: sectors.reduce((sum, r) => sum + r.institutionsBuying, 0),
      totalNetValueChangeUsd: sectors.reduce((sum, r) => sum + r.netValueChangeUsd, 0),
      averagePercentIncrease: avgPct(sectors),
      sectorCount: sectors.length,
    },
    sectors,
  };
}

function buildIndustryPayload(
  current: string,
  previous: string | null,
  rows: Array<{
    sector: string;
    industry: string;
    institutions_buying: string | number;
    institutions_owning: string | number;
    net_value_change_usd: string | number;
    net_shares_change: string | number;
    current_value_usd: string | number;
    previous_value_usd: string | number;
    ticker_count: string | number;
  }>
): IndustryAccumulationPayload {
  const industries: IndustryAccumulationRow[] = rows.map((row) => {
    const netValueChangeUsd = Number(row.net_value_change_usd) || 0;
    const previousValueUsd = Number(row.previous_value_usd) || 0;
    return {
      sector: row.sector,
      sectorSlug: slug(row.sector),
      industry: row.industry,
      industrySlug: slug(row.industry),
      institutionsBuying: Number(row.institutions_buying) || 0,
      institutionsOwning: Number(row.institutions_owning) || 0,
      netValueChangeUsd,
      netSharesChange: Number(row.net_shares_change) || 0,
      currentValueUsd: Number(row.current_value_usd) || 0,
      previousValueUsd,
      percentIncrease: pctIncrease(netValueChangeUsd, previousValueUsd),
      tickerCount: Number(row.ticker_count) || 0,
    };
  });
  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    summary: {
      topIndustry: industries[0]
        ? {
            industry: industries[0].industry,
            sector: industries[0].sector,
            netValueChangeUsd: industries[0].netValueChangeUsd,
          }
        : null,
      totalInstitutionsBuying: industries.reduce((sum, r) => sum + r.institutionsBuying, 0),
      totalNetValueChangeUsd: industries.reduce((sum, r) => sum + r.netValueChangeUsd, 0),
      averagePercentIncrease: avgPct(industries),
      industryCount: industries.length,
    },
    industries,
  };
}

/** Compute sector + industry accumulation in one DB pass (shared CTE). */
async function ensureAccumulationPair(
  pool: pg.Pool
): Promise<{ sectors: SectorAccumulationPayload; industries: IndustryAccumulationPayload }> {
  if (
    sectorCache &&
    industryCache &&
    cacheFresh(sectorCache.at) &&
    cacheFresh(industryCache.at)
  ) {
    return { sectors: sectorCache.payload, industries: industryCache.payload };
  }

  const disk = readSectorDiskCache<{
    sectors: SectorAccumulationPayload;
    industries: IndustryAccumulationPayload;
  }>(DISK_CACHE_NAME, DISK_CACHE_VERSION);
  if (disk?.sectors && disk?.industries) {
    const at = Date.now();
    sectorCache = { at, payload: disk.sectors };
    industryCache = { at, payload: disk.industries };
    return disk;
  }

  if (pairInflight) return pairInflight;

  pairInflight = (async () => {
    await getStocksRepository().ensureSchema();
    const { current, previous } = await latestQuarters(pool);
    if (!current || !previous) {
      const sectors = emptySectorPayload(current, previous);
      const industries = emptyIndustryPayload(current, previous);
      sectorCache = { at: Date.now(), payload: sectors };
      industryCache = { at: Date.now(), payload: industries };
      return { sectors, industries };
    }

    const res = await pool.query<{
      sectors: Array<{
        sector: string;
        institutions_buying: number;
        institutions_owning: number;
        net_value_change_usd: number;
        net_shares_change: number;
        current_value_usd: number;
        previous_value_usd: number;
        ticker_count: number;
      }> | null;
      industries: Array<{
        sector: string;
        industry: string;
        institutions_buying: number;
        institutions_owning: number;
        net_value_change_usd: number;
        net_shares_change: number;
        current_value_usd: number;
        previous_value_usd: number;
        ticker_count: number;
      }> | null;
    }>(
      `
      WITH ${HOLDINGS_PAIR_CTE},
      inst_sector AS (
        SELECT
          filer_cik,
          sector,
          SUM(value_change)::float8 AS value_change,
          SUM(shares_change)::float8 AS shares_change,
          SUM(cur_value)::float8 AS cur_value,
          SUM(prev_value)::float8 AS prev_value
        FROM classified
        GROUP BY filer_cik, sector
      ),
      sector_tickers AS (
        SELECT sector, COUNT(DISTINCT ticker)::int AS ticker_count
        FROM classified
        GROUP BY sector
      ),
      sector_rows AS (
        SELECT
          i.sector,
          COUNT(*) FILTER (WHERE i.value_change > 0)::int AS institutions_buying,
          COUNT(*) FILTER (WHERE i.cur_value > 0)::int AS institutions_owning,
          COALESCE(SUM(i.value_change), 0)::float8 AS net_value_change_usd,
          COALESCE(SUM(i.shares_change), 0)::float8 AS net_shares_change,
          COALESCE(SUM(i.cur_value), 0)::float8 AS current_value_usd,
          COALESCE(SUM(i.prev_value), 0)::float8 AS previous_value_usd,
          COALESCE(MAX(t.ticker_count), 0)::int AS ticker_count
        FROM inst_sector i
        LEFT JOIN sector_tickers t ON t.sector = i.sector
        GROUP BY i.sector
      ),
      classified_ind AS (
        SELECT *
        FROM classified
        WHERE industry IS NOT NULL AND BTRIM(industry) <> ''
      ),
      inst_industry AS (
        SELECT
          filer_cik,
          sector,
          industry,
          SUM(value_change)::float8 AS value_change,
          SUM(shares_change)::float8 AS shares_change,
          SUM(cur_value)::float8 AS cur_value,
          SUM(prev_value)::float8 AS prev_value
        FROM classified_ind
        GROUP BY filer_cik, sector, industry
      ),
      industry_tickers AS (
        SELECT sector, industry, COUNT(DISTINCT ticker)::int AS ticker_count
        FROM classified_ind
        GROUP BY sector, industry
      ),
      industry_rows AS (
        SELECT
          i.sector,
          i.industry,
          COUNT(*) FILTER (WHERE i.value_change > 0)::int AS institutions_buying,
          COUNT(*) FILTER (WHERE i.cur_value > 0)::int AS institutions_owning,
          COALESCE(SUM(i.value_change), 0)::float8 AS net_value_change_usd,
          COALESCE(SUM(i.shares_change), 0)::float8 AS net_shares_change,
          COALESCE(SUM(i.cur_value), 0)::float8 AS current_value_usd,
          COALESCE(SUM(i.prev_value), 0)::float8 AS previous_value_usd,
          COALESCE(MAX(t.ticker_count), 0)::int AS ticker_count
        FROM inst_industry i
        LEFT JOIN industry_tickers t
          ON t.sector = i.sector AND t.industry = i.industry
        GROUP BY i.sector, i.industry
      )
      SELECT
        COALESCE(
          (
            SELECT json_agg(row_to_json(s) ORDER BY s.net_value_change_usd DESC, s.sector ASC)
            FROM sector_rows s
          ),
          '[]'::json
        ) AS sectors,
        COALESCE(
          (
            SELECT json_agg(row_to_json(i) ORDER BY i.net_value_change_usd DESC, i.industry ASC)
            FROM industry_rows i
          ),
          '[]'::json
        ) AS industries
      `,
      [current, previous]
    );

    const row = res.rows[0];
    const sectors = buildSectorPayload(current, previous, row?.sectors || []);
    const industries = buildIndustryPayload(current, previous, row?.industries || []);
    const at = Date.now();
    sectorCache = { at, payload: sectors };
    industryCache = { at, payload: industries };
    writeSectorDiskCache(DISK_CACHE_NAME, DISK_CACHE_VERSION, { sectors, industries });
    return { sectors, industries };
  })();

  try {
    return await pairInflight;
  } finally {
    pairInflight = null;
  }
}

export async function loadSectorAccumulation(
  pool: pg.Pool = getPool()
): Promise<SectorAccumulationPayload> {
  const pair = await ensureAccumulationPair(pool);
  return pair.sectors;
}

export async function loadIndustryAccumulation(
  pool: pg.Pool = getPool()
): Promise<IndustryAccumulationPayload> {
  const pair = await ensureAccumulationPair(pool);
  return pair.industries;
}

import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getPoliticianMostAccumulated } from "../politicians/analytics/service.js";
import { getStocksRepository } from "./stocksRepository.js";
import { latestHoldingQuarters } from "./latestHoldingQuarters.js";
import { readSectorDiskCache, writeSectorDiskCache } from "./sectorDiskCache.js";

const DISK_CACHE_VERSION = 1;
const DISK_CACHE_NAME = "selling";

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

/** Share-based USD delta (excludes pure price drift on unchanged shares). */
const SHARE_BASED_USD_EXPR = `
CASE
  WHEN COALESCE(m.cur_shares, 0) = COALESCE(m.prev_shares, 0) THEN 0::float8
  WHEN COALESCE(m.prev_shares, 0) = 0 AND COALESCE(m.cur_shares, 0) > 0 THEN COALESCE(m.cur_value, 0)::float8
  WHEN COALESCE(m.cur_shares, 0) = 0 AND COALESCE(m.prev_shares, 0) > 0 THEN -COALESCE(m.prev_value, 0)::float8
  ELSE (COALESCE(m.cur_shares, 0) - COALESCE(m.prev_shares, 0)) * COALESCE(
    CASE
      WHEN COALESCE(m.cur_shares, 0) > 0 AND COALESCE(m.cur_value, 0) > 0
        THEN COALESCE(m.cur_value, 0) / m.cur_shares
    END,
    CASE
      WHEN COALESCE(m.prev_shares, 0) > 0 AND COALESCE(m.prev_value, 0) > 0
        THEN COALESCE(m.prev_value, 0) / m.prev_shares
    END,
    0::float8
  )
END
`.trim();

const CACHE_TTL_MS = 30 * 60 * 1000;
const TOP_N = 10;

export interface SectorSellingStockRow {
  rank: number;
  ticker: string;
  companyName: string | null;
  industry: string | null;
  industrySlug: string | null;
  sector: string;
  sectorSlug: string;
  netSharesSold: number;
  institutionsSelling: number;
  netInstitutionalSellingUsd: number;
  politicianSellingUsd: number;
  totalNetSellingUsd: number;
}

export interface SectorSellingSectorRow {
  rank: number;
  sector: string;
  sectorSlug: string;
  stockCount: number;
  totalNetSharesSold: number;
  totalNetSellingUsd: number;
  stocks: SectorSellingStockRow[];
}

export interface SectorSellingPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  politicianPeriodLabel: string;
  summary: {
    sectorCount: number;
    stockCount: number;
    totalNetSharesSold: number;
    totalNetSellingUsd: number;
    topSector: { sector: string; totalNetSharesSold: number; totalNetSellingUsd: number } | null;
  };
  sectors: SectorSellingSectorRow[];
}

function slug(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundShares(n: number): number {
  return Math.round(n * 100) / 100;
}

async function latestQuarters(pool: pg.Pool): Promise<{ current: string; previous: string | null }> {
  return latestHoldingQuarters(pool);
}

async function loadKnownSectors(pool: pg.Pool): Promise<string[]> {
  const res = await pool.query<{ sector: string }>(
    `SELECT DISTINCT sector
     FROM stocks
     WHERE sector IS NOT NULL AND BTRIM(sector) <> ''
     ORDER BY sector ASC`
  );
  return res.rows.map((r) => String(r.sector));
}

interface InstTickerRow {
  ticker: string;
  companyName: string | null;
  sector: string;
  industry: string | null;
  institutionsSelling: number;
  netSharesSold: number;
  netInstitutionalSellingUsd: number;
}

async function loadInstitutionalTickerSelling(
  pool: pg.Pool,
  current: string,
  previous: string
): Promise<InstTickerRow[]> {
  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string;
    industry: string | null;
    institutions_selling: string | number;
    net_shares_sold: string | number;
    net_institutional_selling_usd: string | number;
  }>(
    `
    WITH ${CUSIP_MAP_CTE},
    cur AS (
      SELECT
        h.filer_cik,
        ${RESOLVED_TICKER_EXPR} AS ticker,
        SUM(h.shares)::float8 AS shares,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd
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
        SUM(h.shares)::float8 AS shares,
        SUM(COALESCE(h.value, h.value_usd_thousands * 1000))::float8 AS value_usd
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
        COALESCE(c.shares, 0)::float8 AS cur_shares,
        COALESCE(p.shares, 0)::float8 AS prev_shares,
        COALESCE(c.value_usd, 0)::float8 AS cur_value,
        COALESCE(p.value_usd, 0)::float8 AS prev_value
      FROM cur c
      FULL OUTER JOIN prev p
        ON p.filer_cik = c.filer_cik AND p.ticker = c.ticker
    ),
    classified AS (
      SELECT
        m.ticker,
        st.company_name,
        st.sector,
        st.industry,
        m.cur_shares,
        m.prev_shares,
        (${SHARE_BASED_USD_EXPR}) AS share_based_usd
      FROM merged m
      INNER JOIN stocks st ON st.ticker = m.ticker
      WHERE st.sector IS NOT NULL AND BTRIM(st.sector) <> ''
    )
    SELECT
      ticker,
      MAX(company_name) AS company_name,
      sector,
      MAX(industry) AS industry,
      COUNT(*) FILTER (WHERE cur_shares < prev_shares)::int AS institutions_selling,
      SUM(GREATEST(prev_shares - cur_shares, 0))::float8 AS net_shares_sold,
      SUM(GREATEST(-share_based_usd, 0))::float8 AS net_institutional_selling_usd
    FROM classified
    GROUP BY ticker, sector
    HAVING SUM(GREATEST(prev_shares - cur_shares, 0)) > 0
        OR SUM(GREATEST(-share_based_usd, 0)) > 0
    `,
    [current, previous]
  );

  return res.rows.map((row) => ({
    ticker: String(row.ticker || "")
      .trim()
      .toUpperCase(),
    companyName: row.company_name ? String(row.company_name) : null,
    sector: String(row.sector),
    industry: row.industry ? String(row.industry) : null,
    institutionsSelling: Number(row.institutions_selling) || 0,
    netSharesSold: roundShares(Number(row.net_shares_sold) || 0),
    netInstitutionalSellingUsd: roundUsd(Number(row.net_institutional_selling_usd) || 0),
  }));
}

let cache: { at: number; payload: SectorSellingPayload } | null = null;
let inflight: Promise<SectorSellingPayload> | null = null;

function emptyPayload(current: string, previous: string | null): SectorSellingPayload {
  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    politicianPeriodLabel: "Last quarter",
    summary: {
      sectorCount: 0,
      stockCount: 0,
      totalNetSharesSold: 0,
      totalNetSellingUsd: 0,
      topSector: null,
    },
    sectors: [],
  };
}

function buildPayload(
  current: string,
  previous: string | null,
  knownSectors: string[],
  instRows: InstTickerRow[],
  polSellByTicker: Map<string, number>
): SectorSellingPayload {
  type Draft = {
    ticker: string;
    companyName: string | null;
    industry: string | null;
    sector: string;
    netSharesSold: number;
    institutionsSelling: number;
    netInstitutionalSellingUsd: number;
    politicianSellingUsd: number;
    totalNetSellingUsd: number;
  };

  const byTicker = new Map<string, Draft>();

  for (const row of instRows) {
    if (!row.ticker) continue;
    const politicianSellingUsd = roundUsd(polSellByTicker.get(row.ticker) || 0);
    const totalNetSellingUsd = roundUsd(row.netInstitutionalSellingUsd + politicianSellingUsd);
    byTicker.set(row.ticker, {
      ticker: row.ticker,
      companyName: row.companyName,
      industry: row.industry,
      sector: row.sector,
      netSharesSold: row.netSharesSold,
      institutionsSelling: row.institutionsSelling,
      netInstitutionalSellingUsd: row.netInstitutionalSellingUsd,
      politicianSellingUsd,
      totalNetSellingUsd,
    });
  }

  const bySector = new Map<string, Draft[]>();
  for (const sector of knownSectors) bySector.set(sector, []);

  for (const draft of byTicker.values()) {
    const list = bySector.get(draft.sector);
    if (!list) continue;
    if (
      draft.netSharesSold <= 0 &&
      draft.institutionsSelling === 0 &&
      draft.politicianSellingUsd <= 0
    ) {
      continue;
    }
    list.push(draft);
  }

  const sectors: SectorSellingSectorRow[] = knownSectors.map((sector) => {
    const stocks = [...(bySector.get(sector) || [])]
      .sort(
        (a, b) =>
          b.totalNetSellingUsd - a.totalNetSellingUsd ||
          b.netSharesSold - a.netSharesSold ||
          a.ticker.localeCompare(b.ticker)
      )
      .slice(0, TOP_N)
      .map((row, idx) => ({
        rank: idx + 1,
        ticker: row.ticker,
        companyName: row.companyName,
        industry: row.industry,
        industrySlug: row.industry ? slug(row.industry) : null,
        sector: row.sector,
        sectorSlug: slug(row.sector),
        netSharesSold: row.netSharesSold,
        institutionsSelling: row.institutionsSelling,
        netInstitutionalSellingUsd: row.netInstitutionalSellingUsd,
        politicianSellingUsd: row.politicianSellingUsd,
        totalNetSellingUsd: row.totalNetSellingUsd,
      }));

    const totalNetSharesSold = roundShares(stocks.reduce((s, r) => s + r.netSharesSold, 0));
    const totalNetSellingUsd = roundUsd(stocks.reduce((s, r) => s + r.totalNetSellingUsd, 0));
    return {
      rank: 0,
      sector,
      sectorSlug: slug(sector),
      stockCount: stocks.length,
      totalNetSharesSold,
      totalNetSellingUsd,
      stocks,
    };
  });

  sectors.sort(
    (a, b) =>
      b.totalNetSellingUsd - a.totalNetSellingUsd ||
      b.totalNetSharesSold - a.totalNetSharesSold ||
      a.sector.localeCompare(b.sector)
  );
  sectors.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  const stockCount = sectors.reduce((s, r) => s + r.stockCount, 0);
  const totalNetSharesSold = roundShares(sectors.reduce((s, r) => s + r.totalNetSharesSold, 0));
  const totalNetSellingUsd = roundUsd(sectors.reduce((s, r) => s + r.totalNetSellingUsd, 0));
  const top = sectors[0] ?? null;

  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    politicianPeriodLabel: "Last quarter",
    summary: {
      sectorCount: sectors.length,
      stockCount,
      totalNetSharesSold,
      totalNetSellingUsd,
      topSector: top
        ? { sector: top.sector, totalNetSharesSold: top.totalNetSharesSold, totalNetSellingUsd: top.totalNetSellingUsd }
        : null,
    },
    sectors,
  };
}

async function computeSectorSelling(pool: pg.Pool): Promise<SectorSellingPayload> {
  await getStocksRepository().ensureSchema();
  const { current, previous } = await latestQuarters(pool);
  if (!current || !previous) return emptyPayload(current, previous);

  const [knownSectors, instRows, polPayload] = await Promise.all([
    loadKnownSectors(pool),
    loadInstitutionalTickerSelling(pool, current, previous),
    Promise.resolve(getPoliticianMostAccumulated("quarter", "all")),
  ]);

  const polSellByTicker = new Map<string, number>();
  for (const row of polPayload.stocks || []) {
    const ticker = String(row.ticker || "")
      .trim()
      .toUpperCase();
    if (!ticker) continue;
    const net = Number(row.netAmountUsd);
    if (!Number.isFinite(net) || net >= 0) continue;
    polSellByTicker.set(ticker, roundUsd(-net));
  }

  const missing = [...polSellByTicker.keys()].filter((t) => !instRows.some((r) => r.ticker === t));
  if (missing.length) {
    const res = await pool.query<{
      ticker: string;
      company_name: string | null;
      sector: string;
      industry: string | null;
    }>(
      `SELECT ticker, company_name, sector, industry
       FROM stocks
       WHERE ticker = ANY($1::text[])
         AND sector IS NOT NULL AND BTRIM(sector) <> ''`,
      [missing]
    );
    for (const row of res.rows) {
      const ticker = String(row.ticker).toUpperCase();
      const politicianSellingUsd = roundUsd(polSellByTicker.get(ticker) || 0);
      instRows.push({
        ticker,
        companyName: row.company_name ? String(row.company_name) : null,
        sector: String(row.sector),
        industry: row.industry ? String(row.industry) : null,
        institutionsSelling: 0,
        netSharesSold: 0,
        netInstitutionalSellingUsd: 0,
      });
    }
  }

  return buildPayload(current, previous, knownSectors, instRows, polSellByTicker);
}

export async function loadSectorSelling(pool: pg.Pool = getPool()): Promise<SectorSellingPayload> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;

  const disk = readSectorDiskCache<SectorSellingPayload>(DISK_CACHE_NAME, DISK_CACHE_VERSION);
  if (disk) {
    cache = { at: Date.now(), payload: disk };
    return disk;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const payload = await computeSectorSelling(pool);
      cache = { at: Date.now(), payload };
      writeSectorDiskCache(DISK_CACHE_NAME, DISK_CACHE_VERSION, payload);
      return payload;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

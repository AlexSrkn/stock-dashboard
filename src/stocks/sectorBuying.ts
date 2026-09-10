import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getPoliticianMostAccumulated } from "../politicians/analytics/service.js";
import { getStocksRepository } from "./stocksRepository.js";
import { latestHoldingQuarters } from "./latestHoldingQuarters.js";
import { readSectorDiskCache, writeSectorDiskCache } from "./sectorDiskCache.js";

const DISK_CACHE_VERSION = 1;
const DISK_CACHE_NAME = "buying";

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
const TOP_N = 10;

export interface SectorBuyingStockRow {
  rank: number;
  ticker: string;
  companyName: string | null;
  industry: string | null;
  industrySlug: string | null;
  sector: string;
  sectorSlug: string;
  netInstitutionalBuyingUsd: number;
  institutionsBuying: number;
  politicianBuyingUsd: number;
  totalNetBuyingUsd: number;
}

export interface SectorBuyingSectorRow {
  rank: number;
  sector: string;
  sectorSlug: string;
  stockCount: number;
  totalNetBuyingUsd: number;
  stocks: SectorBuyingStockRow[];
}

export interface SectorBuyingPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  politicianPeriodLabel: string;
  summary: {
    sectorCount: number;
    stockCount: number;
    totalNetBuyingUsd: number;
    topSector: { sector: string; totalNetBuyingUsd: number } | null;
  };
  sectors: SectorBuyingSectorRow[];
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
  institutionsBuying: number;
  netInstitutionalBuyingUsd: number;
}

async function loadInstitutionalTickerBuying(
  pool: pg.Pool,
  current: string,
  previous: string
): Promise<InstTickerRow[]> {
  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string;
    industry: string | null;
    institutions_buying: string | number;
    net_institutional_buying_usd: string | number;
  }>(
    `
    WITH ${CUSIP_MAP_CTE},
    cur AS (
      SELECT
        h.filer_cik,
        ${RESOLVED_TICKER_EXPR} AS ticker,
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
        (m.cur_value - m.prev_value) AS value_change
      FROM merged m
      INNER JOIN stocks st ON st.ticker = m.ticker
      WHERE st.sector IS NOT NULL AND BTRIM(st.sector) <> ''
    )
    SELECT
      ticker,
      MAX(company_name) AS company_name,
      sector,
      MAX(industry) AS industry,
      COUNT(*) FILTER (WHERE value_change > 0)::int AS institutions_buying,
      SUM(value_change)::float8 AS net_institutional_buying_usd
    FROM classified
    GROUP BY ticker, sector
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
    institutionsBuying: Number(row.institutions_buying) || 0,
    netInstitutionalBuyingUsd: roundUsd(Number(row.net_institutional_buying_usd) || 0),
  }));
}

let cache: { at: number; payload: SectorBuyingPayload } | null = null;
let inflight: Promise<SectorBuyingPayload> | null = null;

function emptyPayload(current: string, previous: string | null): SectorBuyingPayload {
  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    politicianPeriodLabel: "Last quarter",
    summary: {
      sectorCount: 0,
      stockCount: 0,
      totalNetBuyingUsd: 0,
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
  polByTicker: Map<string, number>
): SectorBuyingPayload {
  type Draft = {
    ticker: string;
    companyName: string | null;
    industry: string | null;
    sector: string;
    netInstitutionalBuyingUsd: number;
    institutionsBuying: number;
    politicianBuyingUsd: number;
    totalNetBuyingUsd: number;
  };

  const byTicker = new Map<string, Draft>();

  for (const row of instRows) {
    if (!row.ticker) continue;
    const politicianBuyingUsd = roundUsd(polByTicker.get(row.ticker) || 0);
    const totalNetBuyingUsd = roundUsd(row.netInstitutionalBuyingUsd + politicianBuyingUsd);
    byTicker.set(row.ticker, {
      ticker: row.ticker,
      companyName: row.companyName,
      industry: row.industry,
      sector: row.sector,
      netInstitutionalBuyingUsd: row.netInstitutionalBuyingUsd,
      institutionsBuying: row.institutionsBuying,
      politicianBuyingUsd,
      totalNetBuyingUsd,
    });
  }

  const bySector = new Map<string, Draft[]>();
  for (const sector of knownSectors) bySector.set(sector, []);

  for (const draft of byTicker.values()) {
    const list = bySector.get(draft.sector);
    if (!list) continue;
    if (
      draft.totalNetBuyingUsd === 0 &&
      draft.institutionsBuying === 0 &&
      draft.politicianBuyingUsd === 0
    ) {
      continue;
    }
    list.push(draft);
  }

  const sectors: SectorBuyingSectorRow[] = knownSectors.map((sector) => {
    const stocks = [...(bySector.get(sector) || [])]
      .sort(
        (a, b) =>
          b.totalNetBuyingUsd - a.totalNetBuyingUsd ||
          b.netInstitutionalBuyingUsd - a.netInstitutionalBuyingUsd ||
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
        netInstitutionalBuyingUsd: row.netInstitutionalBuyingUsd,
        institutionsBuying: row.institutionsBuying,
        politicianBuyingUsd: row.politicianBuyingUsd,
        totalNetBuyingUsd: row.totalNetBuyingUsd,
      }));

    const totalNetBuyingUsd = roundUsd(stocks.reduce((s, r) => s + r.totalNetBuyingUsd, 0));
    return {
      rank: 0,
      sector,
      sectorSlug: slug(sector),
      stockCount: stocks.length,
      totalNetBuyingUsd,
      stocks,
    };
  });

  sectors.sort(
    (a, b) =>
      b.totalNetBuyingUsd - a.totalNetBuyingUsd || a.sector.localeCompare(b.sector)
  );
  sectors.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  const stockCount = sectors.reduce((s, r) => s + r.stockCount, 0);
  const totalNetBuyingUsd = roundUsd(sectors.reduce((s, r) => s + r.totalNetBuyingUsd, 0));
  const top = sectors[0] ?? null;

  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    politicianPeriodLabel: "Last quarter",
    summary: {
      sectorCount: sectors.length,
      stockCount,
      totalNetBuyingUsd,
      topSector: top ? { sector: top.sector, totalNetBuyingUsd: top.totalNetBuyingUsd } : null,
    },
    sectors,
  };
}

async function computeSectorBuying(pool: pg.Pool): Promise<SectorBuyingPayload> {
  await getStocksRepository().ensureSchema();
  const { current, previous } = await latestQuarters(pool);
  if (!current || !previous) return emptyPayload(current, previous);

  const [knownSectors, instRows, polPayload] = await Promise.all([
    loadKnownSectors(pool),
    loadInstitutionalTickerBuying(pool, current, previous),
    Promise.resolve(getPoliticianMostAccumulated("quarter", "all")),
  ]);

  const polByTicker = new Map<string, number>();
  for (const row of polPayload.stocks || []) {
    const ticker = String(row.ticker || "")
      .trim()
      .toUpperCase();
    if (!ticker) continue;
    const net = Number(row.netAmountUsd);
    if (!Number.isFinite(net) || net === 0) continue;
    polByTicker.set(ticker, roundUsd(net));
  }

  // Politician-only tickers: look up sector/industry from stocks
  const missing = [...polByTicker.keys()].filter((t) => !instRows.some((r) => r.ticker === t));
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
      instRows.push({
        ticker,
        companyName: row.company_name ? String(row.company_name) : null,
        sector: String(row.sector),
        industry: row.industry ? String(row.industry) : null,
        institutionsBuying: 0,
        netInstitutionalBuyingUsd: 0,
      });
    }
  }

  return buildPayload(current, previous, knownSectors, instRows, polByTicker);
}

export async function loadSectorBuying(pool: pg.Pool = getPool()): Promise<SectorBuyingPayload> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;

  const disk = readSectorDiskCache<SectorBuyingPayload>(DISK_CACHE_NAME, DISK_CACHE_VERSION);
  if (disk) {
    cache = { at: Date.now(), payload: disk };
    return disk;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const payload = await computeSectorBuying(pool);
      cache = { at: Date.now(), payload };
      writeSectorDiskCache(DISK_CACHE_NAME, DISK_CACHE_VERSION, payload);
      return payload;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

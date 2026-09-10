import type pg from "pg";
import {
  classifyInstitutionActivity,
  valueAttributableToShareChange,
} from "../institution/institutionAnalytics.js";
import { getPool } from "../db/pool.js";
import { canonicalFundName } from "../ownership/trackedInstitutions.js";
import { getStocksRepository } from "./stocksRepository.js";
import { latestHoldingQuarters } from "./latestHoldingQuarters.js";

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
/** Max institution×industry rows returned in the flat ranked list. */
const MAX_RANKED_INSTITUTIONS = 500;

export interface ConcentrationPositionRef {
  ticker: string;
  companyName: string | null;
  valueUsd: number;
}

export interface ConcentrationIncreaseRef {
  ticker: string;
  companyName: string | null;
  netPositionIncreaseUsd: number;
}

export interface ConcentrationInstitutionRow {
  rank: number;
  institutionId: string;
  institutionName: string;
  sector: string;
  sectorSlug: string;
  industry: string;
  industrySlug: string;
  netPositionIncreaseUsd: number;
  portfolioExposureChangePct: number | null;
  currentExposurePct: number | null;
  previousExposurePct: number | null;
  stocksHeld: number;
  stocksIncreased: number;
  stocksDecreased: number;
  largestPosition: ConcentrationPositionRef | null;
  largestPositionIncrease: ConcentrationIncreaseRef | null;
}

export interface ConcentrationStockRow {
  ticker: string;
  companyName: string | null;
  shareChange: number;
  netPositionIncreaseUsd: number;
  currentValueUsd: number;
  previousValueUsd: number;
  currentShares: number;
  previousShares: number;
  activity: "new" | "add" | "trim" | "closed" | "unchanged";
}

export interface InstitutionalConcentrationPayload {
  computedAt: string;
  currentQuarter: string;
  previousQuarter: string | null;
  summary: {
    institutionCount: number;
    totalNetPositionIncreaseUsd: number;
    topInstitution: {
      institutionName: string;
      sector: string;
      industry: string;
      netPositionIncreaseUsd: number;
    } | null;
  };
  /** Flat list ranked by share-based net position increase (institution × industry). */
  institutions: ConcentrationInstitutionRow[];
}

type StockDetailKey = string;

interface InternalCache {
  at: number;
  payload: InstitutionalConcentrationPayload;
  stocksByKey: Map<StockDetailKey, ConcentrationStockRow[]>;
}

let cache: InternalCache | null = null;
let inflight: Promise<InternalCache> | null = null;

function slug(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

function padCik(cik: string): string {
  const digits = String(cik || "").replace(/\D/g, "");
  return digits.padStart(10, "0");
}

function bareCik(cik: string): string {
  return String(cik || "").replace(/\D/g, "").replace(/^0+/, "") || "0";
}

function stockKey(cik: string, sectorSlug: string, industrySlug: string): StockDetailKey {
  return `${bareCik(cik)}::${sectorSlug}::${industrySlug}`;
}

function sectorStockKey(cik: string, sectorSlug: string): StockDetailKey {
  return `${bareCik(cik)}::${sectorSlug}::__sector__`;
}

function fixImpliedValue(shares: number, valueUsd: number): number {
  if (!(shares > 0) || !(valueUsd > 0)) return valueUsd;
  const px = valueUsd / shares;
  if (px > 10_000) return valueUsd / 1000;
  return valueUsd;
}

function shareBasedNetUsd(
  priorShares: number,
  currentShares: number,
  priorValueUsd: number,
  currentValueUsd: number
): number {
  const pv = fixImpliedValue(priorShares, priorValueUsd);
  const cv = fixImpliedValue(currentShares, currentValueUsd);
  return valueAttributableToShareChange(priorShares, currentShares, pv, cv) ?? 0;
}

function exposurePct(part: number, total: number): number | null {
  if (!(total > 0) || !Number.isFinite(part)) return null;
  return roundPct((part / total) * 100);
}

function exposureChangePct(cur: number | null, prev: number | null): number | null {
  if (cur == null) return null;
  if (prev == null || prev === 0) return cur > 0 ? null : 0;
  return roundPct(((cur - prev) / prev) * 100);
}

async function latestQuarters(pool: pg.Pool): Promise<{ current: string; previous: string | null }> {
  return latestHoldingQuarters(pool);
}

interface RawHoldingRow {
  filer_cik: string;
  fund_name: string;
  ticker: string;
  company_name: string | null;
  sector: string;
  industry: string | null;
  cur_shares: string | number;
  prev_shares: string | number;
  cur_value: string | number;
  prev_value: string | number;
  cur_portfolio: string | number;
  prev_portfolio: string | number;
}

async function loadRawHoldings(
  pool: pg.Pool,
  current: string,
  previous: string
): Promise<RawHoldingRow[]> {
  const res = await pool.query<RawHoldingRow>(
    `
    WITH ${CUSIP_MAP_CTE},
    cur AS (
      SELECT
        h.filer_cik,
        MAX(h.fund_name) AS fund_name,
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
        MAX(h.fund_name) AS fund_name,
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
        COALESCE(NULLIF(BTRIM(c.fund_name), ''), NULLIF(BTRIM(p.fund_name), ''), COALESCE(c.filer_cik, p.filer_cik)) AS fund_name,
        COALESCE(c.ticker, p.ticker) AS ticker,
        COALESCE(c.shares, 0)::float8 AS cur_shares,
        COALESCE(p.shares, 0)::float8 AS prev_shares,
        COALESCE(c.value_usd, 0)::float8 AS cur_value,
        COALESCE(p.value_usd, 0)::float8 AS prev_value
      FROM cur c
      FULL OUTER JOIN prev p
        ON p.filer_cik = c.filer_cik AND p.ticker = c.ticker
    ),
    portfolios AS (
      SELECT
        filer_cik,
        SUM(cur_value)::float8 AS cur_portfolio,
        SUM(prev_value)::float8 AS prev_portfolio
      FROM merged
      GROUP BY filer_cik
    )
    SELECT
      m.filer_cik,
      m.fund_name,
      m.ticker,
      st.company_name,
      st.sector,
      st.industry,
      m.cur_shares,
      m.prev_shares,
      m.cur_value,
      m.prev_value,
      pf.cur_portfolio,
      pf.prev_portfolio
    FROM merged m
    INNER JOIN stocks st ON st.ticker = m.ticker
    INNER JOIN portfolios pf ON pf.filer_cik = m.filer_cik
    WHERE st.sector IS NOT NULL AND BTRIM(st.sector) <> ''
    `,
    [current, previous]
  );
  return res.rows;
}

interface AggBucket {
  institutionId: string;
  institutionName: string;
  sector: string;
  industry: string;
  netPositionIncreaseUsd: number;
  currentValueUsd: number;
  previousValueUsd: number;
  portfolioCur: number;
  portfolioPrev: number;
  stocksHeld: number;
  stocksIncreased: number;
  stocksDecreased: number;
  largestPosition: ConcentrationPositionRef | null;
  largestPositionIncrease: ConcentrationIncreaseRef | null;
  stocks: ConcentrationStockRow[];
}

function ensureBucket(
  map: Map<string, AggBucket>,
  key: string,
  seed: Omit<
    AggBucket,
    | "netPositionIncreaseUsd"
    | "currentValueUsd"
    | "previousValueUsd"
    | "stocksHeld"
    | "stocksIncreased"
    | "stocksDecreased"
    | "largestPosition"
    | "largestPositionIncrease"
    | "stocks"
  > & { portfolioCur: number; portfolioPrev: number }
): AggBucket {
  let row = map.get(key);
  if (!row) {
    row = {
      ...seed,
      netPositionIncreaseUsd: 0,
      currentValueUsd: 0,
      previousValueUsd: 0,
      stocksHeld: 0,
      stocksIncreased: 0,
      stocksDecreased: 0,
      largestPosition: null,
      largestPositionIncrease: null,
      stocks: [],
    };
    map.set(key, row);
  }
  return row;
}

function applyStockToBucket(bucket: AggBucket, stock: ConcentrationStockRow): void {
  bucket.netPositionIncreaseUsd = roundUsd(bucket.netPositionIncreaseUsd + stock.netPositionIncreaseUsd);
  bucket.currentValueUsd = roundUsd(bucket.currentValueUsd + stock.currentValueUsd);
  bucket.previousValueUsd = roundUsd(bucket.previousValueUsd + stock.previousValueUsd);
  if (stock.currentShares > 0) bucket.stocksHeld += 1;
  if (stock.activity === "new" || stock.activity === "add") bucket.stocksIncreased += 1;
  if (stock.activity === "trim" || stock.activity === "closed") bucket.stocksDecreased += 1;

  if (
    stock.currentValueUsd > 0 &&
    (!bucket.largestPosition || stock.currentValueUsd > bucket.largestPosition.valueUsd)
  ) {
    bucket.largestPosition = {
      ticker: stock.ticker,
      companyName: stock.companyName,
      valueUsd: stock.currentValueUsd,
    };
  }
  if (
    stock.netPositionIncreaseUsd > 0 &&
    (!bucket.largestPositionIncrease ||
      stock.netPositionIncreaseUsd > bucket.largestPositionIncrease.netPositionIncreaseUsd)
  ) {
    bucket.largestPositionIncrease = {
      ticker: stock.ticker,
      companyName: stock.companyName,
      netPositionIncreaseUsd: stock.netPositionIncreaseUsd,
    };
  }
  bucket.stocks.push(stock);
}

function toInstitutionRow(bucket: AggBucket, rank: number): ConcentrationInstitutionRow {
  const currentExposurePct = exposurePct(bucket.currentValueUsd, bucket.portfolioCur);
  const previousExposurePct = exposurePct(bucket.previousValueUsd, bucket.portfolioPrev);
  return {
    rank,
    institutionId: bareCik(bucket.institutionId),
    institutionName: bucket.institutionName,
    sector: bucket.sector,
    sectorSlug: slug(bucket.sector),
    industry: bucket.industry,
    industrySlug: slug(bucket.industry),
    netPositionIncreaseUsd: roundUsd(bucket.netPositionIncreaseUsd),
    portfolioExposureChangePct: exposureChangePct(currentExposurePct, previousExposurePct),
    currentExposurePct,
    previousExposurePct,
    stocksHeld: bucket.stocksHeld,
    stocksIncreased: bucket.stocksIncreased,
    stocksDecreased: bucket.stocksDecreased,
    largestPosition: bucket.largestPosition,
    largestPositionIncrease: bucket.largestPositionIncrease,
  };
}

function emptyPayload(current: string, previous: string | null): InstitutionalConcentrationPayload {
  return {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    summary: {
      institutionCount: 0,
      totalNetPositionIncreaseUsd: 0,
      topInstitution: null,
    },
    institutions: [],
  };
}

async function computeConcentration(pool: pg.Pool): Promise<InternalCache> {
  await getStocksRepository().ensureSchema();
  const { current, previous } = await latestQuarters(pool);
  if (!current || !previous) {
    return {
      at: Date.now(),
      payload: emptyPayload(current, previous),
      stocksByKey: new Map(),
    };
  }

  const raw = await loadRawHoldings(pool, current, previous);
  const industryBuckets = new Map<string, AggBucket>();
  const stocksByKey = new Map<StockDetailKey, ConcentrationStockRow[]>();

  for (const row of raw) {
    const cik = padCik(String(row.filer_cik));
    const ticker = String(row.ticker || "")
      .trim()
      .toUpperCase();
    if (!ticker) continue;
    const sector = String(row.sector || "").trim();
    if (!sector) continue;
    const industry = String(row.industry || "").trim() || "Unclassified";
    const curShares = Number(row.cur_shares) || 0;
    const prevShares = Number(row.prev_shares) || 0;
    let curValue = Number(row.cur_value) || 0;
    let prevValue = Number(row.prev_value) || 0;
    curValue = fixImpliedValue(curShares, curValue);
    prevValue = fixImpliedValue(prevShares, prevValue);
    const portfolioCur = Number(row.cur_portfolio) || 0;
    const portfolioPrev = Number(row.prev_portfolio) || 0;
    const activity = classifyInstitutionActivity(prevShares, curShares);
    const netUsd = shareBasedNetUsd(prevShares, curShares, prevValue, curValue);
    const companyName = row.company_name ? String(row.company_name) : null;
    const institutionName = canonicalFundName(cik, String(row.fund_name || cik));

    const stock: ConcentrationStockRow = {
      ticker,
      companyName,
      shareChange: roundUsd(curShares - prevShares),
      netPositionIncreaseUsd: roundUsd(netUsd),
      currentValueUsd: roundUsd(curValue),
      previousValueUsd: roundUsd(prevValue),
      currentShares: curShares,
      previousShares: prevShares,
      activity,
    };

    const indKey = `${bareCik(cik)}::${sector}::${industry}`;
    const indBucket = ensureBucket(industryBuckets, indKey, {
      institutionId: cik,
      institutionName,
      sector,
      industry,
      portfolioCur,
      portfolioPrev,
    });
    applyStockToBucket(indBucket, stock);
  }

  const rankedBuckets = [...industryBuckets.values()]
    .filter((b) => b.netPositionIncreaseUsd !== 0 || b.stocksHeld > 0)
    .sort(
      (a, b) =>
        b.netPositionIncreaseUsd - a.netPositionIncreaseUsd ||
        a.institutionName.localeCompare(b.institutionName)
    )
    .slice(0, MAX_RANKED_INSTITUTIONS);

  const institutions = rankedBuckets.map((b, idx) => toInstitutionRow(b, idx + 1));

  for (const bucket of rankedBuckets) {
    stocksByKey.set(
      stockKey(bucket.institutionId, slug(bucket.sector), slug(bucket.industry)),
      [...bucket.stocks].sort(
        (a, b) =>
          b.netPositionIncreaseUsd - a.netPositionIncreaseUsd || a.ticker.localeCompare(b.ticker)
      )
    );
  }

  const top = institutions[0] ?? null;
  const payload: InstitutionalConcentrationPayload = {
    computedAt: new Date().toISOString(),
    currentQuarter: current,
    previousQuarter: previous,
    summary: {
      institutionCount: institutions.length,
      totalNetPositionIncreaseUsd: roundUsd(
        institutions.reduce((s, r) => s + Math.max(0, r.netPositionIncreaseUsd), 0)
      ),
      topInstitution: top
        ? {
            institutionName: top.institutionName,
            sector: top.sector,
            industry: top.industry,
            netPositionIncreaseUsd: top.netPositionIncreaseUsd,
          }
        : null,
    },
    institutions,
  };

  return { at: Date.now(), payload, stocksByKey };
}

async function ensureCache(pool: pg.Pool): Promise<InternalCache> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const next = await computeConcentration(pool);
      cache = next;
      return next;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function loadInstitutionalConcentration(
  pool: pg.Pool = getPool()
): Promise<InstitutionalConcentrationPayload> {
  const c = await ensureCache(pool);
  return c.payload;
}

export async function loadInstitutionalConcentrationStocks(
  institutionId: string,
  sectorSlug: string,
  industrySlug: string | null = null,
  pool: pg.Pool = getPool()
): Promise<{
  institutionId: string;
  sectorSlug: string;
  industrySlug: string | null;
  stocks: ConcentrationStockRow[];
} | null> {
  const c = await ensureCache(pool);
  const cik = bareCik(institutionId);
  const key = industrySlug
    ? stockKey(cik, sectorSlug, industrySlug)
    : sectorStockKey(cik, sectorSlug);
  const stocks = c.stocksByKey.get(key);
  if (!stocks) return null;
  return {
    institutionId: cik,
    sectorSlug,
    industrySlug,
    stocks,
  };
}

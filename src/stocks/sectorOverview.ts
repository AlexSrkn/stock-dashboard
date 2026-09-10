import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getStocksRepository } from "./stocksRepository.js";
import { loadSectorSummaries } from "./sectorAnalytics.js";

/** Same slug style as politician sector exposure. */
export function sectorOverviewSlug(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function matchOverviewSlug(slug: string, candidates: string[]): string | null {
  const normalized = String(slug || "").toLowerCase();
  return candidates.find((c) => sectorOverviewSlug(c) === normalized) ?? null;
}

const OVERVIEW_CACHE_TTL_MS = 30 * 60 * 1000;
let overviewCache: { at: number; payload: SectorOverviewPayload } | null = null;
const sectorDetailCache = new Map<string, { at: number; payload: SectorDetailPayload }>();
const industryDetailCache = new Map<string, { at: number; payload: IndustryDetailPayload }>();

function cacheFresh(at: number): boolean {
  return Date.now() - at < OVERVIEW_CACHE_TTL_MS;
}

export interface SectorOverviewMetrics {
  companyCount: number;
  industryCount: number;
  approxMarketCapUsd: number | null;
  institutionalValueUsd: number | null;
  institutionalFlowUsd: number | null;
  medianRevenueGrowthYoy: number | null;
  medianOperatingMargin: number | null;
  medianInstitutionalOwnershipPct: number | null;
  avgInstitutionCount: number | null;
}

export interface SectorOverviewCard extends SectorOverviewMetrics {
  sector: string;
  sectorSlug: string;
  industries: string[];
}

export interface IndustryOverviewCard extends SectorOverviewMetrics {
  sector: string;
  sectorSlug: string;
  industry: string;
  industrySlug: string;
}

export interface SectorStockRow {
  ticker: string;
  companyName: string | null;
  sector: string;
  industry: string | null;
  approxMarketCapUsd: number | null;
  revenueGrowthYoy: number | null;
  operatingMargin: number | null;
  institutionalOwnershipPct: number | null;
  institutionCount: number | null;
  ownershipTrend: string | null;
  institutionalValueUsd: number | null;
}

export interface SectorOverviewPayload {
  computedAt: string;
  currentQuarter: string | null;
  previousQuarter: string | null;
  sectors: SectorOverviewCard[];
}

export interface SectorDetailPayload {
  computedAt: string;
  sector: string;
  sectorSlug: string;
  metrics: SectorOverviewMetrics;
  industries: IndustryOverviewCard[];
}

export interface IndustryDetailPayload {
  computedAt: string;
  sector: string;
  sectorSlug: string;
  industry: string;
  industrySlug: string;
  metrics: SectorOverviewMetrics;
  stocks: SectorStockRow[];
}

function emptyMetrics(companyCount = 0, industryCount = 0): SectorOverviewMetrics {
  return {
    companyCount,
    industryCount,
    approxMarketCapUsd: null,
    institutionalValueUsd: null,
    institutionalFlowUsd: null,
    medianRevenueGrowthYoy: null,
    medianOperatingMargin: null,
    medianInstitutionalOwnershipPct: null,
    avgInstitutionCount: null,
  };
}

export async function loadSectorOverview(
  pool: pg.Pool = getPool()
): Promise<SectorOverviewPayload> {
  if (overviewCache && cacheFresh(overviewCache.at)) {
    return overviewCache.payload;
  }

  await getStocksRepository().ensureSchema();
  // Directory UI only needs names + industry/stock counts. Skip multi-minute
  // sec_holding ownership/flow scans here; Fundamentals covers ratio metrics.
  const summaries = await loadSectorSummaries(pool);

  const sectors: SectorOverviewCard[] = summaries.sectors.map((s) => ({
    sector: s.sector,
    sectorSlug: sectorOverviewSlug(s.sector),
    industries: s.industries,
    companyCount: s.stockCount,
    industryCount: s.industries.length,
    approxMarketCapUsd: null,
    institutionalValueUsd: null,
    institutionalFlowUsd: null,
    medianRevenueGrowthYoy: null,
    medianOperatingMargin: null,
    medianInstitutionalOwnershipPct: null,
    avgInstitutionCount: null,
  }));

  sectors.sort(
    (a, b) =>
      b.companyCount - a.companyCount || a.sector.localeCompare(b.sector)
  );

  const payload: SectorOverviewPayload = {
    computedAt: new Date().toISOString(),
    currentQuarter: null,
    previousQuarter: null,
    sectors,
  };
  overviewCache = { at: Date.now(), payload };
  return payload;
}

export async function loadSectorDetail(
  sectorSlugParam: string,
  pool: pg.Pool = getPool()
): Promise<SectorDetailPayload | null> {
  const cacheKey = sectorOverviewSlug(sectorSlugParam);
  const cached = sectorDetailCache.get(cacheKey);
  if (cached && cacheFresh(cached.at)) return cached.payload;

  await getStocksRepository().ensureSchema();
  const overview = await loadSectorOverview(pool);
  const sectorName = matchOverviewSlug(
    sectorSlugParam,
    overview.sectors.map((s) => s.sector)
  );
  if (!sectorName) return null;

  const sectorCard = overview.sectors.find((s) => s.sector === sectorName)!;
  const summaries = await loadSectorSummaries(pool);
  const summaryRow = summaries.sectors.find((s) => s.sector === sectorName);
  const industrySummaries = summaryRow?.industrySummaries || [];

  const industries: IndustryOverviewCard[] = (
    industrySummaries.length
      ? industrySummaries
      : sectorCard.industries.map((industry) => ({ industry, stockCount: 0 }))
  ).map((item) => ({
    sector: sectorName,
    sectorSlug: sectorOverviewSlug(sectorName),
    industry: item.industry,
    industrySlug: sectorOverviewSlug(item.industry),
    companyCount: item.stockCount || 0,
    industryCount: 1,
    approxMarketCapUsd: null,
    institutionalValueUsd: null,
    institutionalFlowUsd: null,
    medianRevenueGrowthYoy: null,
    medianOperatingMargin: null,
    medianInstitutionalOwnershipPct: null,
    avgInstitutionCount: null,
  }));

  industries.sort(
    (a, b) =>
      b.companyCount - a.companyCount || a.industry.localeCompare(b.industry)
  );

  const payload: SectorDetailPayload = {
    computedAt: new Date().toISOString(),
    sector: sectorName,
    sectorSlug: sectorOverviewSlug(sectorName),
    metrics: {
      companyCount: sectorCard.companyCount,
      industryCount: sectorCard.industryCount,
      approxMarketCapUsd: null,
      institutionalValueUsd: null,
      institutionalFlowUsd: null,
      medianRevenueGrowthYoy: null,
      medianOperatingMargin: null,
      medianInstitutionalOwnershipPct: null,
      avgInstitutionCount: null,
    },
    industries,
  };
  sectorDetailCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

export async function loadIndustryDetail(
  sectorSlugParam: string,
  industrySlugParam: string,
  pool: pg.Pool = getPool()
): Promise<IndustryDetailPayload | null> {
  const cacheKey = `${sectorOverviewSlug(sectorSlugParam)}::${sectorOverviewSlug(industrySlugParam)}`;
  const cached = industryDetailCache.get(cacheKey);
  if (cached && cacheFresh(cached.at)) return cached.payload;

  await getStocksRepository().ensureSchema();
  const summaries = await loadSectorSummaries(pool);
  const sectorName = matchOverviewSlug(
    sectorSlugParam,
    summaries.sectors.map((s) => s.sector)
  );
  if (!sectorName) return null;
  const sectorRow = summaries.sectors.find((s) => s.sector === sectorName)!;
  const industryName = matchOverviewSlug(industrySlugParam, sectorRow.industries);
  if (!industryName) return null;

  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string;
    industry: string | null;
  }>(
    `
    SELECT ticker, company_name, sector, industry
    FROM stocks
    WHERE sector = $1 AND industry = $2
    ORDER BY company_name NULLS LAST, ticker ASC
    `,
    [sectorName, industryName]
  );

  const stocks: SectorStockRow[] = res.rows.map((row) => ({
    ticker: row.ticker,
    companyName: row.company_name,
    sector: row.sector,
    industry: row.industry,
    approxMarketCapUsd: null,
    revenueGrowthYoy: null,
    operatingMargin: null,
    institutionalOwnershipPct: null,
    institutionCount: null,
    ownershipTrend: null,
    institutionalValueUsd: null,
  }));

  const payload: IndustryDetailPayload = {
    computedAt: new Date().toISOString(),
    sector: sectorName,
    sectorSlug: sectorOverviewSlug(sectorName),
    industry: industryName,
    industrySlug: sectorOverviewSlug(industryName),
    metrics: {
      ...emptyMetrics(stocks.length, 1),
      companyCount: stocks.length,
      industryCount: 1,
    },
    stocks,
  };
  industryDetailCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

import type pg from "pg";
import { getTrackedInstitutionByCik } from "../../ownership/trackedInstitutions.js";
import { formatSecCik } from "../../sec/http.js";
import { enrichRowsWithTickers } from "../resolveTicker.js";
import { resolveInstitutionCik } from "../institutionAnalytics.js";
import { SELECT_COMPARE_HOLDINGS_SQL, SELECT_STOCK_ENRICHMENT_SQL } from "./queries.js";
import type {
  CompareHoldingRow,
  CompareLargestHolding,
  CompareSectorSlice,
  InstitutionComparePayload,
  InstitutionCompareSide,
  InstitutionCompareStats,
  SharedCompareHoldingRow,
} from "./types.js";

interface RawHoldingRow {
  cusip: string;
  ticker: string | null;
  issuer: string;
  shares: number;
  value_usd_thousands: number;
  quarter: string;
  filing_date: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function filingValueUsd(valueThousands: number | null | undefined): number {
  const x = Number(valueThousands);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return round2(x * 1000);
}

async function loadStockEnrichment(
  pool: pg.Pool,
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null }>> {
  if (!tickers.length) return new Map();
  const res = await pool.query<{
    ticker: string;
    company_name: string | null;
    sector: string | null;
  }>(SELECT_STOCK_ENRICHMENT_SQL, [tickers]);
  const out = new Map<string, { companyName: string | null; sector: string | null }>();
  for (const row of res.rows) {
    out.set(String(row.ticker).toUpperCase(), {
      companyName: row.company_name ? String(row.company_name) : null,
      sector: row.sector ? String(row.sector) : null,
    });
  }
  return out;
}

function buildSectorAllocation(
  holdings: CompareHoldingRow[],
  portfolioValueUsd: number
): CompareSectorSlice[] {
  const bySector = new Map<string, number>();
  for (const row of holdings) {
    if (!row.sector) continue;
    bySector.set(row.sector, (bySector.get(row.sector) ?? 0) + row.valueUsd);
  }
  return [...bySector.entries()]
    .map(([sector, valueUsd]) => ({
      sector,
      valueUsd: round2(valueUsd),
      weightPct:
        portfolioValueUsd > 0 ? round2((valueUsd / portfolioValueUsd) * 100) : 0,
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

function toCompareHoldingRow(
  row: RawHoldingRow & { ticker: string | null },
  portfolioValueUsd: number,
  enrichment: Map<string, { companyName: string | null; sector: string | null }>
): CompareHoldingRow {
  const valueUsd = filingValueUsd(row.value_usd_thousands);
  const ticker = row.ticker ? String(row.ticker).toUpperCase() : null;
  const meta = ticker ? enrichment.get(ticker) : undefined;
  return {
    cusip: String(row.cusip),
    ticker,
    companyName: meta?.companyName ?? (row.issuer ? String(row.issuer) : null),
    sector: meta?.sector ?? null,
    valueUsd,
    weightPct: portfolioValueUsd > 0 ? round2((valueUsd / portfolioValueUsd) * 100) : 0,
    shares: round2(Number(row.shares)),
    quarter: row.quarter,
  };
}

function buildSide(
  cik: string,
  holdings: CompareHoldingRow[],
  quarter: string,
  filingDate: string
): InstitutionCompareSide {
  const manager = getTrackedInstitutionByCik(cik)!;
  const portfolioValueUsd = round2(holdings.reduce((sum, h) => sum + h.valueUsd, 0));
  const sorted = [...holdings].sort((a, b) => b.valueUsd - a.valueUsd);
  const largest = sorted[0];
  const sectorAllocation = buildSectorAllocation(holdings, portfolioValueUsd);
  const largestHolding: CompareLargestHolding | null = largest
    ? {
        ticker: largest.ticker,
        companyName: largest.companyName,
        valueUsd: largest.valueUsd,
        weightPct: largest.weightPct,
      }
    : null;

  return {
    cik,
    name: manager.name,
    type: manager.type,
    quarter,
    filingDate,
    portfolioValueUsd,
    holdingsCount: holdings.length,
    largestHolding,
    topSector: sectorAllocation[0] ?? null,
    topHoldings: sorted.slice(0, 25),
    sectorAllocation,
  };
}

function buildStats(
  sharedCount: number,
  uniqueToACount: number,
  uniqueToBCount: number,
  sharedHoldings: SharedCompareHoldingRow[],
  uniqueToA: CompareHoldingRow[],
  uniqueToB: CompareHoldingRow[],
  hasSectorData: boolean
): InstitutionCompareStats {
  const unionCount = sharedCount + uniqueToACount + uniqueToBCount;
  const jaccardSimilarityPct =
    unionCount > 0 ? round2((sharedCount / unionCount) * 100) : 0;

  // Overlap of portfolio weights: sum of min(weightA, weightB) across the union of holdings.
  const weightByCusipA = new Map<string, number>();
  const weightByCusipB = new Map<string, number>();
  for (const row of sharedHoldings) {
    weightByCusipA.set(row.cusip, row.institutionA.weightPct);
    weightByCusipB.set(row.cusip, row.institutionB.weightPct);
  }
  for (const row of uniqueToA) weightByCusipA.set(row.cusip, row.weightPct);
  for (const row of uniqueToB) weightByCusipB.set(row.cusip, row.weightPct);

  const allCusips = new Set([
    ...weightByCusipA.keys(),
    ...weightByCusipB.keys(),
  ]);
  let weightedOverlap = 0;
  for (const cusip of allCusips) {
    weightedOverlap += Math.min(weightByCusipA.get(cusip) ?? 0, weightByCusipB.get(cusip) ?? 0);
  }

  return {
    sharedCount,
    uniqueToACount,
    uniqueToBCount,
    jaccardSimilarityPct,
    weightedSimilarityPct: round2(weightedOverlap),
    hasSectorData,
  };
}

export async function compareInstitutions(
  pool: pg.Pool,
  cikA: string,
  cikB: string
): Promise<InstitutionComparePayload | null> {
  const a = resolveInstitutionCik(cikA);
  const b = resolveInstitutionCik(cikB);
  if (!a || !b) return null;
  if (a === b) {
    throw new Error("Select two different institutions to compare.");
  }

  const res = await pool.query<{
    filer_cik: string;
    quarter: string;
    filing_date: string;
    cusip: string;
    ticker: string | null;
    issuer: string;
    shares: number;
    value_usd_thousands: number;
  }>(SELECT_COMPARE_HOLDINGS_SQL, [[a, b]]);

  const byFiler = new Map<string, RawHoldingRow[]>();
  const metaByFiler = new Map<string, { quarter: string; filingDate: string }>();

  for (const row of res.rows) {
    const filer = formatSecCik(row.filer_cik);
    if (!metaByFiler.has(filer)) {
      metaByFiler.set(filer, {
        quarter: String(row.quarter),
        filingDate: String(row.filing_date),
      });
    }
    const list = byFiler.get(filer) ?? [];
    list.push({
      cusip: String(row.cusip),
      ticker: row.ticker ? String(row.ticker) : null,
      issuer: String(row.issuer),
      shares: Number(row.shares),
      value_usd_thousands: Number(row.value_usd_thousands),
      quarter: String(row.quarter),
      filing_date: String(row.filing_date),
    });
    byFiler.set(filer, list);
  }

  const rawA = byFiler.get(a) ?? [];
  const rawB = byFiler.get(b) ?? [];
  const metaA = metaByFiler.get(a);
  const metaB = metaByFiler.get(b);

  if (!metaA || !metaB) {
    throw new Error("One or both institutions have no 13F holdings on file.");
  }

  const enrichedA = await enrichRowsWithTickers(rawA);
  const enrichedB = await enrichRowsWithTickers(rawB);

  const tickers = [
    ...new Set(
      [...enrichedA, ...enrichedB]
        .map((r) => (r.ticker ? String(r.ticker).toUpperCase() : null))
        .filter(Boolean)
    ),
  ] as string[];
  const enrichment = await loadStockEnrichment(pool, tickers);

  const totalA = enrichedA.reduce((sum, r) => sum + filingValueUsd(r.value_usd_thousands), 0);
  const totalB = enrichedB.reduce((sum, r) => sum + filingValueUsd(r.value_usd_thousands), 0);

  const holdingsA = enrichedA.map((r) => toCompareHoldingRow(r, totalA, enrichment));
  const holdingsB = enrichedB.map((r) => toCompareHoldingRow(r, totalB, enrichment));

  const mapA = new Map(holdingsA.map((h) => [h.cusip, h]));
  const mapB = new Map(holdingsB.map((h) => [h.cusip, h]));

  const sharedHoldings: SharedCompareHoldingRow[] = [];
  const uniqueToA: CompareHoldingRow[] = [];
  const uniqueToB: CompareHoldingRow[] = [];

  for (const [cusip, rowA] of mapA) {
    const rowB = mapB.get(cusip);
    if (rowB) {
      sharedHoldings.push({
        cusip,
        ticker: rowA.ticker ?? rowB.ticker,
        companyName: rowA.companyName ?? rowB.companyName,
        sector: rowA.sector ?? rowB.sector,
        institutionA: {
          valueUsd: rowA.valueUsd,
          weightPct: rowA.weightPct,
          shares: rowA.shares,
        },
        institutionB: {
          valueUsd: rowB.valueUsd,
          weightPct: rowB.weightPct,
          shares: rowB.shares,
        },
        weightDifferencePct: round2(rowA.weightPct - rowB.weightPct),
      });
    } else {
      uniqueToA.push(rowA);
    }
  }

  for (const [cusip, rowB] of mapB) {
    if (!mapA.has(cusip)) uniqueToB.push(rowB);
  }

  sharedHoldings.sort((x, y) => y.institutionA.valueUsd - x.institutionA.valueUsd);
  uniqueToA.sort((x, y) => y.valueUsd - x.valueUsd);
  uniqueToB.sort((x, y) => y.valueUsd - x.valueUsd);

  const hasSectorData = holdingsA.some((h) => h.sector) || holdingsB.some((h) => h.sector);

  const institutionA = buildSide(a, holdingsA, metaA.quarter, metaA.filingDate);
  const institutionB = buildSide(b, holdingsB, metaB.quarter, metaB.filingDate);

  return {
    computedAt: new Date().toISOString(),
    institutionA,
    institutionB,
    stats: buildStats(
      sharedHoldings.length,
      uniqueToA.length,
      uniqueToB.length,
      sharedHoldings,
      uniqueToA,
      uniqueToB,
      hasSectorData
    ),
    sharedHoldings,
    uniqueToA,
    uniqueToB,
  };
}

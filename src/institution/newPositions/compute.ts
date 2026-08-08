import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getInstitutionActivity, listTrackedInstitutions } from "../institutionAnalytics.js";
import { sortQuarters } from "../performance/quarters.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "./queries.js";
import type {
  NewInstitutionalPositionRow,
  NewPositionsPayload,
  NewPositionsSummary,
} from "./types.js";

const BATCH_SIZE = 8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

function buildSummary(positions: NewInstitutionalPositionRow[]): NewPositionsSummary {
  const institutionIds = new Set(positions.map((p) => p.institutionId));
  const tickers = new Set(positions.map((p) => p.ticker).filter(Boolean));
  return {
    totalNewPositions: positions.length,
    institutionsReporting: institutionIds.size,
    uniqueStocks: tickers.size,
    totalReportedValueUsd: round2(
      positions.reduce((sum, p) => sum + (p.positionValueUsd ?? 0), 0)
    ),
  };
}

export async function computeNewInstitutionalPositions(
  pool: pg.Pool = getPool()
): Promise<NewPositionsPayload> {
  const funds = listTrackedInstitutions();
  const positions: NewInstitutionalPositionRow[] = [];

  for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    const batchRows = await Promise.all(
      batch.map(async (fund) => {
        const activity = await getInstitutionActivity(pool, fund.cik, 5000);
        if (!activity?.meta.currentQuarter) return [];

        const portfolioUsd = activity.meta.portfolioValueUsd;
        return activity.newPositions
          .filter((row) => row.previousShares === 0 && row.currentShares > 0)
          .map((row) => ({
            institutionId: fund.cik,
            institutionName: fund.name,
            institutionType: fund.type,
            ticker: row.ticker ? String(row.ticker).toUpperCase() : null,
            companyName: row.issuer ? String(row.issuer) : null,
            sector: null as string | null,
            cusip: row.cusip,
            quarter: activity.meta.currentQuarter ?? "",
            filingDate: activity.meta.latestFilingDate,
            positionValueUsd: row.currentValueUsd,
            shares: row.currentShares,
            portfolioWeightPct:
              row.currentValueUsd != null && portfolioUsd != null && portfolioUsd > 0
                ? round2((row.currentValueUsd / portfolioUsd) * 100)
                : null,
            previousPosition: "None" as const,
          }));
      })
    );
    positions.push(...batchRows.flat());
  }

  const tickers = [...new Set(positions.map((p) => p.ticker).filter(Boolean))] as string[];
  const enrichment = await loadStockEnrichment(pool, tickers);
  for (const row of positions) {
    if (!row.ticker) continue;
    const meta = enrichment.get(row.ticker);
    if (!meta) continue;
    if (meta.companyName) row.companyName = meta.companyName;
    row.sector = meta.sector;
  }

  positions.sort((a, b) => (b.positionValueUsd ?? 0) - (a.positionValueUsd ?? 0));

  const quarters = sortQuarters([...new Set(positions.map((p) => p.quarter).filter(Boolean))]);
  const sectors = [...new Set(positions.map((p) => p.sector).filter(Boolean))].sort() as string[];

  return {
    computedAt: new Date().toISOString(),
    quarters,
    sectors,
    institutions: funds.map((f) => ({ cik: f.cik, name: f.name })),
    summary: buildSummary(positions),
    positions,
  };
}

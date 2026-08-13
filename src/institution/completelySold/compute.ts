import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getInstitutionActivity, listTrackedInstitutions } from "../institutionAnalytics.js";
import { sortQuarters } from "../performance/quarters.js";
import { SELECT_STOCK_ENRICHMENT_SQL } from "./queries.js";
import type {
  CompletelySoldPayload,
  CompletelySoldPositionRow,
  CompletelySoldSummary,
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

interface RawExit {
  institutionId: string;
  ticker: string;
  companyName: string | null;
  quarter: string;
  previousPositionValueUsd: number;
  previousShares: number;
}

export function aggregateCompletelySoldByTicker(raw: RawExit[]): CompletelySoldPositionRow[] {
  return aggregateByTicker(raw);
}

function aggregateByTicker(raw: RawExit[]): CompletelySoldPositionRow[] {
  const byTicker = new Map<
    string,
    {
      companyName: string | null;
      previousPositionValueUsd: number;
      previousShares: number;
      institutionIds: Set<string>;
      quarters: Set<string>;
    }
  >();

  for (const row of raw) {
    const ticker = row.ticker.toUpperCase();
    const cur = byTicker.get(ticker) ?? {
      companyName: row.companyName,
      previousPositionValueUsd: 0,
      previousShares: 0,
      institutionIds: new Set<string>(),
      quarters: new Set<string>(),
    };
    if (!cur.companyName && row.companyName) cur.companyName = row.companyName;
    cur.previousPositionValueUsd += row.previousPositionValueUsd;
    cur.previousShares += row.previousShares;
    cur.institutionIds.add(row.institutionId);
    if (row.quarter) cur.quarters.add(row.quarter);
    byTicker.set(ticker, cur);
  }

  return [...byTicker.entries()].map(([ticker, agg]) => ({
    ticker,
    companyName: agg.companyName,
    sector: null,
    previousPositionValueUsd: round2(agg.previousPositionValueUsd),
    previousShares: round2(agg.previousShares),
    institutionsExiting: agg.institutionIds.size,
    quarters: sortQuarters(agg.quarters),
    currentPosition: "Sold" as const,
  }));
}

function buildSummary(
  positions: CompletelySoldPositionRow[],
  institutionCount: number
): CompletelySoldSummary {
  return {
    totalStocksSold: positions.length,
    institutionsReporting: institutionCount,
    uniqueStocksSold: positions.length,
    totalValueExitedUsd: round2(
      positions.reduce((sum, p) => sum + (p.previousPositionValueUsd ?? 0), 0)
    ),
  };
}

export async function computeCompletelySoldPositions(
  pool: pg.Pool = getPool()
): Promise<CompletelySoldPayload> {
  const funds = listTrackedInstitutions();
  const raw: RawExit[] = [];
  const institutionsWithExits = new Set<string>();

  for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    const batchRows = await Promise.all(
      batch.map(async (fund) => {
        const activity = await getInstitutionActivity(pool, fund.cik, 5000);
        if (!activity?.meta.currentQuarter) return [] as RawExit[];
        if (!activity.completelySold.length) return [] as RawExit[];
        institutionsWithExits.add(fund.cik);
        return activity.completelySold
          .map((row) => {
            const ticker = row.ticker ? String(row.ticker).trim().toUpperCase() : "";
            if (!ticker) return null;
            const previousPositionValueUsd = Number(row.previousValueUsd);
            const previousShares = Number(row.previousShares);
            if (!Number.isFinite(previousPositionValueUsd) || previousPositionValueUsd <= 0) {
              return null;
            }
            return {
              institutionId: fund.cik,
              ticker,
              companyName: row.issuer ? String(row.issuer) : null,
              quarter: activity.meta.currentQuarter ?? "",
              previousPositionValueUsd,
              previousShares: Number.isFinite(previousShares) ? previousShares : 0,
            } satisfies RawExit;
          })
          .filter((r): r is RawExit => r != null);
      })
    );
    raw.push(...batchRows.flat());
  }

  const positions = aggregateByTicker(raw);
  const tickers = positions.map((p) => p.ticker);
  const enrichment = await loadStockEnrichment(pool, tickers);
  for (const row of positions) {
    const meta = enrichment.get(row.ticker);
    if (!meta) continue;
    if (meta.companyName) row.companyName = meta.companyName;
    row.sector = meta.sector;
  }

  positions.sort((a, b) => b.previousPositionValueUsd - a.previousPositionValueUsd);

  const quarters = sortQuarters([
    ...new Set(positions.flatMap((p) => p.quarters).filter(Boolean)),
  ]);
  const sectors = [...new Set(positions.map((p) => p.sector).filter(Boolean))].sort() as string[];

  return {
    computedAt: new Date().toISOString(),
    quarters,
    sectors,
    summary: buildSummary(positions, institutionsWithExits.size),
    positions,
  };
}

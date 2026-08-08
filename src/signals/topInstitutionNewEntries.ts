import type pg from "pg";
import { getPool } from "../db/pool.js";
import { getInstitutionActivity, listTrackedInstitutions } from "../institution/institutionAnalytics.js";
import { getInstitutionPerformanceService } from "../institution/performance/performanceService.js";

export const TOP_PERFORMER_COUNT = 10;

export interface TopInstitutionNewEntryRow {
  ticker: string;
  issuer: string;
  cusip: string;
  institutionId: string;
  institutionName: string;
  institutionType: string;
  institutionRank: number;
  institutionRolling1yReturn: number | null;
  currentShares: number;
  currentValueUsd: number | null;
  quarter: string;
}

export interface TopInstitutionSummary {
  rank: number;
  institutionId: string;
  name: string;
  type: string;
  quarter: string;
  rolling1yReturn: number | null;
  newEntryCount: number;
}

export interface TopInstitutionNewEntriesPayload {
  computedAt: string;
  period: "rolling_1y";
  asOfQuarter: string | null;
  topInstitutionCount: number;
  institutions: TopInstitutionSummary[];
  entries: TopInstitutionNewEntryRow[];
}

export async function computeTopInstitutionNewEntries(
  pool: pg.Pool = getPool(),
  topN = TOP_PERFORMER_COUNT
): Promise<TopInstitutionNewEntriesPayload> {
  const funds = listTrackedInstitutions();
  const perfService = getInstitutionPerformanceService();
  const rankings = await perfService.getRankings("rolling_1y", funds);

  const top = rankings.rankings
    .filter((r) => r.return != null)
    .slice(0, topN);

  const institutions: TopInstitutionSummary[] = [];
  const entries: TopInstitutionNewEntryRow[] = [];

  for (const inst of top) {
    const cik = inst.institutionId;
    const activity = await getInstitutionActivity(pool, cik, 500);
    if (!activity) continue;

    const newRows = activity.newPositions.filter((r) => r.currentShares > 0);
    institutions.push({
      rank: inst.rank,
      institutionId: cik,
      name: inst.name,
      type: inst.type,
      quarter: activity.meta.currentQuarter ?? inst.quarter,
      rolling1yReturn: inst.return,
      newEntryCount: newRows.length,
    });

    for (const row of newRows) {
      const ticker = row.ticker ? String(row.ticker).trim().toUpperCase() : "";
      if (!ticker) continue;
      entries.push({
        ticker,
        issuer: row.issuer,
        cusip: row.cusip,
        institutionId: cik,
        institutionName: inst.name,
        institutionType: inst.type,
        institutionRank: inst.rank,
        institutionRolling1yReturn: inst.return,
        currentShares: row.currentShares,
        currentValueUsd: row.currentValueUsd,
        quarter: activity.meta.currentQuarter ?? inst.quarter,
      });
    }
  }

  entries.sort((a, b) => {
    if (a.institutionRank !== b.institutionRank) return a.institutionRank - b.institutionRank;
    return (b.currentValueUsd ?? 0) - (a.currentValueUsd ?? 0);
  });

  return {
    computedAt: new Date().toISOString(),
    period: "rolling_1y",
    asOfQuarter: rankings.asOfQuarter,
    topInstitutionCount: top.length,
    institutions,
    entries,
  };
}

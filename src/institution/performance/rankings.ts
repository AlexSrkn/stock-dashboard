import type { InstitutionPerformanceSummary } from "./types.js";
import { compareQuarters } from "./quarters.js";

export type PerformancePeriod = "rolling_1y" | "qoq" | "ytd";

export interface InstitutionRankingInput {
  cik: string;
  name: string;
  type: string;
}

export interface InstitutionRankingRow {
  rank: number;
  institutionId: string;
  name: string;
  type: string;
  quarter: string;
  return: number | null;
  consistencyScore: number | null;
  volatility: number | null;
}

export interface InstitutionRankingsResult {
  period: PerformancePeriod;
  asOfQuarter: string | null;
  rankings: InstitutionRankingRow[];
}

function periodReturn(
  row: InstitutionPerformanceSummary,
  period: PerformancePeriod
): number | null {
  if (period === "rolling_1y") return row.rolling1yReturn;
  if (period === "ytd") return row.ytdReturn;
  return row.qoqReturn;
}

function latestRowPerInstitution(
  summaries: InstitutionPerformanceSummary[]
): Map<string, InstitutionPerformanceSummary> {
  const byInst = new Map<string, InstitutionPerformanceSummary>();
  for (const row of summaries) {
    const prev = byInst.get(row.institutionId);
    if (!prev || compareQuarters(row.quarter, prev.quarter) > 0) {
      byInst.set(row.institutionId, row);
    }
  }
  return byInst;
}

export function buildInstitutionRankings(
  summaries: InstitutionPerformanceSummary[],
  institutions: InstitutionRankingInput[],
  period: PerformancePeriod
): InstitutionRankingsResult {
  const latest = latestRowPerInstitution(summaries);
  const nameByCik = new Map(institutions.map((i) => [i.cik, i]));

  const rows: InstitutionRankingRow[] = [];
  let asOfQuarter: string | null = null;

  for (const [institutionId, row] of latest) {
    if (!asOfQuarter || compareQuarters(row.quarter, asOfQuarter) > 0) {
      asOfQuarter = row.quarter;
    }
    const meta = nameByCik.get(institutionId);
    rows.push({
      rank: 0,
      institutionId,
      name: meta?.name ?? institutionId,
      type: meta?.type ?? "Institution",
      quarter: row.quarter,
      return: periodReturn(row, period),
      consistencyScore: row.consistencyScore,
      volatility: row.volatility,
    });
  }

  rows.sort((a, b) => {
    const ar = a.return;
    const br = b.return;
    if (ar == null && br == null) return a.name.localeCompare(b.name);
    if (ar == null) return 1;
    if (br == null) return -1;
    if (br !== ar) return br - ar;
    return a.name.localeCompare(b.name);
  });

  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  return { period, asOfQuarter, rankings: rows };
}

export function parsePerformancePeriod(raw: string | null | undefined): PerformancePeriod {
  const p = String(raw || "").trim().toLowerCase();
  if (p === "qoq" || p === "quarter") return "qoq";
  if (p === "ytd") return "ytd";
  return "rolling_1y";
}

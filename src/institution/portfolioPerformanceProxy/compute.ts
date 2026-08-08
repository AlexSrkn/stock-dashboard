import { previousQuarter, sortQuarters } from "../performance/quarters.js";
import type {
  PortfolioProxyFilters,
  PortfolioProxyRankingRow,
  PortfolioProxySortKey,
  PortfolioValuePoint,
} from "./types.js";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function shiftQuartersBack(quarter: string, steps: number): string | null {
  let cursor: string | null = quarter;
  for (let i = 0; i < steps; i++) {
    if (!cursor) return null;
    cursor = previousQuarter(cursor);
  }
  return cursor;
}

export function dollarChange(current: number | null | undefined, prior: number | null | undefined): number | null {
  if (current == null || prior == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  return round2(current - prior);
}

export function pctChange(current: number | null | undefined, prior: number | null | undefined): number | null {
  if (current == null || prior == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return round2(((current - prior) / prior) * 100);
}

export interface RawPortfolioSnapshot {
  institutionId: string;
  quarter: string;
  filingDate: string | null;
  holdingsCount: number;
  portfolioValueUsd: number;
}

export function buildHistoryPoints(snapshots: RawPortfolioSnapshot[]): PortfolioValuePoint[] {
  const byQuarter = new Map<string, RawPortfolioSnapshot>();
  for (const s of snapshots) byQuarter.set(s.quarter, s);
  const quarters = sortQuarters(byQuarter.keys());
  return quarters.map((quarter) => {
    const cur = byQuarter.get(quarter)!;
    const prevQ = previousQuarter(quarter);
    const prev = prevQ ? byQuarter.get(prevQ) : undefined;
    return {
      quarter,
      portfolioValueUsd: round2(cur.portfolioValueUsd),
      holdingsCount: cur.holdingsCount,
      filingDate: cur.filingDate,
      qoqChangeUsd: prev ? dollarChange(cur.portfolioValueUsd, prev.portfolioValueUsd) : null,
      qoqChangePct: prev ? pctChange(cur.portfolioValueUsd, prev.portfolioValueUsd) : null,
    };
  });
}

export function metricsAtQuarter(
  history: PortfolioValuePoint[],
  asOfQuarter: string
): {
  current: PortfolioValuePoint | null;
  previous: PortfolioValuePoint | null;
  yearAgo: PortfolioValuePoint | null;
  threeYearAgo: PortfolioValuePoint | null;
} {
  const byQuarter = new Map(history.map((h) => [h.quarter, h]));
  const current = byQuarter.get(asOfQuarter) ?? null;
  if (!current) {
    return { current: null, previous: null, yearAgo: null, threeYearAgo: null };
  }
  const prevQ = previousQuarter(asOfQuarter);
  const y1Q = shiftQuartersBack(asOfQuarter, 4);
  const y3Q = shiftQuartersBack(asOfQuarter, 12);
  return {
    current,
    previous: prevQ ? byQuarter.get(prevQ) ?? null : null,
    yearAgo: y1Q ? byQuarter.get(y1Q) ?? null : null,
    threeYearAgo: y3Q ? byQuarter.get(y3Q) ?? null : null,
  };
}

function nullsLastCompare(
  a: number | null,
  b: number | null,
  dir: "asc" | "desc"
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const mul = dir === "asc" ? 1 : -1;
  return (a - b) * mul;
}

export function sortKeyValue(
  row: PortfolioProxyRankingRow,
  sort: PortfolioProxySortKey
): number | null {
  switch (sort) {
    case "growth_1y":
      return row.change1yPct;
    case "growth_3y":
      return row.change3yPct;
    case "growth_qoq":
      return row.qoqChangePct;
    case "portfolio_value":
      return row.currentPortfolioValueUsd;
    case "dollar_growth":
      return row.change1yUsd ?? row.qoqChangeUsd;
    case "holdings":
      return row.holdingsCount;
    default:
      return row.change1yPct;
  }
}

export function compareProxyRows(
  a: PortfolioProxyRankingRow,
  b: PortfolioProxyRankingRow,
  sort: PortfolioProxySortKey,
  sortDir: "asc" | "desc"
): number {
  const primary = nullsLastCompare(sortKeyValue(a, sort), sortKeyValue(b, sort), sortDir);
  if (primary !== 0) return primary;
  const byValue = nullsLastCompare(
    a.currentPortfolioValueUsd,
    b.currentPortfolioValueUsd,
    "desc"
  );
  if (byValue !== 0) return byValue;
  return a.name.localeCompare(b.name);
}

export function parseSortKey(raw: string | null | undefined): PortfolioProxySortKey {
  const key = String(raw || "").trim();
  switch (key) {
    case "growth_3y":
    case "growth_qoq":
    case "portfolio_value":
    case "dollar_growth":
    case "holdings":
      return key;
    case "growth_1y":
    default:
      return "growth_1y";
  }
}

export function parseSortDir(raw: string | null | undefined): "asc" | "desc" {
  return String(raw || "").toLowerCase() === "asc" ? "asc" : "desc";
}

export function applyProxyFilters(
  rows: PortfolioProxyRankingRow[],
  filters: PortfolioProxyFilters
): PortfolioProxyRankingRow[] {
  const nameQ = String(filters.name || "")
    .trim()
    .toLowerCase();
  const minValue = filters.minPortfolioValue ?? null;
  const minHoldings = filters.minHoldings ?? null;
  const min1y = filters.minGrowth1yPct ?? null;
  const min3y = filters.minGrowth3yPct ?? null;

  return rows.filter((row) => {
    if (nameQ) {
      const hay = `${row.name} ${row.cik}`.toLowerCase();
      if (!hay.includes(nameQ)) return false;
    }
    if (minValue != null && Number.isFinite(minValue) && row.currentPortfolioValueUsd < minValue) {
      return false;
    }
    if (minHoldings != null && Number.isFinite(minHoldings) && row.holdingsCount < minHoldings) {
      return false;
    }
    if (min1y != null && Number.isFinite(min1y)) {
      if (row.change1yPct == null || row.change1yPct < min1y) return false;
    }
    if (min3y != null && Number.isFinite(min3y)) {
      if (row.change3yPct == null || row.change3yPct < min3y) return false;
    }
    return true;
  });
}

export function defaultAsOfQuarter(
  availableQuarters: string[],
  requested: string | null | undefined
): string | null {
  const sorted = sortQuarters(availableQuarters);
  if (!sorted.length) return null;
  const q = String(requested || "").trim();
  if (q && sorted.includes(q)) return q;
  return sorted[sorted.length - 1] ?? null;
}

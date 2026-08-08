import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { listTrackedInstitutions } from "../institutionAnalytics.js";
import { formatSecCik } from "../../sec/http.js";
import { sortQuarters } from "../performance/quarters.js";
import {
  applyProxyFilters,
  buildHistoryPoints,
  compareProxyRows,
  defaultAsOfQuarter,
  dollarChange,
  metricsAtQuarter,
  parseSortDir,
  parseSortKey,
  pctChange,
  type RawPortfolioSnapshot,
} from "./compute.js";
import { SELECT_PORTFOLIO_VALUE_HISTORY_SQL, trackedInstitutionCiks } from "./queries.js";
import type {
  PortfolioProxyFilters,
  PortfolioProxyRankingRow,
  PortfolioProxyRankingsPayload,
} from "./types.js";
import {
  PORTFOLIO_PROXY_DISCLAIMER,
  PORTFOLIO_PROXY_METHODOLOGY,
} from "./types.js";

interface SnapshotCache {
  loadedAt: number;
  snapshots: RawPortfolioSnapshot[];
  availableQuarters: string[];
}

const MEMORY_CACHE_MS = 10 * 60 * 1000;
let snapshotCache: SnapshotCache | null = null;
let inflight: Promise<SnapshotCache> | null = null;

async function loadSnapshots(pool: pg.Pool): Promise<SnapshotCache> {
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.loadedAt < MEMORY_CACHE_MS) {
    return snapshotCache;
  }
  if (!inflight) {
    inflight = (async () => {
      const ciks = trackedInstitutionCiks();
      const res = await pool.query<{
        institution_id: string;
        quarter: string;
        filing_date: string | null;
        holdings_count: number;
        portfolio_value_usd: string | number;
      }>(SELECT_PORTFOLIO_VALUE_HISTORY_SQL, [ciks]);

      const snapshots: RawPortfolioSnapshot[] = res.rows.map((r) => ({
        institutionId: formatSecCik(String(r.institution_id)),
        quarter: String(r.quarter),
        filingDate: r.filing_date ? String(r.filing_date) : null,
        holdingsCount: Number(r.holdings_count) || 0,
        portfolioValueUsd: Number(r.portfolio_value_usd) || 0,
      }));

      const availableQuarters = sortQuarters(snapshots.map((s) => s.quarter));
      const payload: SnapshotCache = {
        loadedAt: Date.now(),
        snapshots,
        availableQuarters,
      };
      snapshotCache = payload;
      return payload;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function buildRowsForQuarter(
  snapshots: RawPortfolioSnapshot[],
  asOfQuarter: string
): PortfolioProxyRankingRow[] {
  const funds = listTrackedInstitutions();
  const byInst = new Map<string, RawPortfolioSnapshot[]>();
  for (const s of snapshots) {
    const list = byInst.get(s.institutionId) ?? [];
    list.push(s);
    byInst.set(s.institutionId, list);
  }

  const rows: PortfolioProxyRankingRow[] = [];
  for (const fund of funds) {
    const cik = formatSecCik(fund.cik);
    const history = buildHistoryPoints(byInst.get(cik) ?? []);
    const m = metricsAtQuarter(history, asOfQuarter);
    if (!m.current) continue;

    rows.push({
      rank: 0,
      cik,
      name: fund.name,
      type: fund.type,
      quarter: asOfQuarter,
      latestFilingDate: m.current.filingDate,
      currentPortfolioValueUsd: m.current.portfolioValueUsd,
      previousPortfolioValueUsd: m.previous?.portfolioValueUsd ?? null,
      qoqChangeUsd: dollarChange(m.current.portfolioValueUsd, m.previous?.portfolioValueUsd),
      qoqChangePct: pctChange(m.current.portfolioValueUsd, m.previous?.portfolioValueUsd),
      yearAgoPortfolioValueUsd: m.yearAgo?.portfolioValueUsd ?? null,
      change1yUsd: dollarChange(m.current.portfolioValueUsd, m.yearAgo?.portfolioValueUsd),
      change1yPct: pctChange(m.current.portfolioValueUsd, m.yearAgo?.portfolioValueUsd),
      threeYearAgoPortfolioValueUsd: m.threeYearAgo?.portfolioValueUsd ?? null,
      change3yUsd: dollarChange(m.current.portfolioValueUsd, m.threeYearAgo?.portfolioValueUsd),
      change3yPct: pctChange(m.current.portfolioValueUsd, m.threeYearAgo?.portfolioValueUsd),
      holdingsCount: m.current.holdingsCount,
      history,
    });
  }
  return rows;
}

export async function getPortfolioPerformanceProxyRankings(
  filters: PortfolioProxyFilters = {},
  pool: pg.Pool = getPool()
): Promise<PortfolioProxyRankingsPayload> {
  const cache = await loadSnapshots(pool);
  const asOfQuarter = defaultAsOfQuarter(cache.availableQuarters, filters.quarter);
  const sort = parseSortKey(filters.sort);
  const sortDir = parseSortDir(filters.sortDir);
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 50));
  const page = Math.max(1, Number(filters.page) || 1);

  let rows = asOfQuarter ? buildRowsForQuarter(cache.snapshots, asOfQuarter) : [];
  rows = applyProxyFilters(rows, filters);
  rows.sort((a, b) => compareProxyRows(a, b, sort, sortDir));
  rows = rows.map((row, i) => ({ ...row, rank: i + 1 }));

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const rankings = rows.slice(start, start + pageSize);

  return {
    label: "13F Portfolio Performance Proxy",
    disclaimer: PORTFOLIO_PROXY_DISCLAIMER,
    methodology: PORTFOLIO_PROXY_METHODOLOGY,
    computedAt: new Date().toISOString(),
    asOfQuarter,
    availableQuarters: cache.availableQuarters,
    sort,
    sortDir,
    page,
    pageSize,
    total,
    totalPages,
    rankings,
  };
}

/** Test helper / cache bust. */
export function clearPortfolioProxyCache(): void {
  snapshotCache = null;
}

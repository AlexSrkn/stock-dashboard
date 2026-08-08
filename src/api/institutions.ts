import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import {
  getInstitutionActivity,
  getInstitutionHistory,
  getInstitutionHoldings,
  getInstitutionOptions,
  listTrackedInstitutions,
  loadInstitutionMeta,
  resolveInstitutionCik,
} from "../institution/institutionAnalytics.js";
import {
  getInstitutionPerformanceService,
  parsePerformancePeriod,
} from "../institution/performance/performanceService.js";
import {
  getMostAccumulatedPeriod,
  parseMostAccumulatedPeriod,
} from "../institution/mostAccumulated/service.js";
import { getNewInstitutionalPositions } from "../institution/newPositions/service.js";
import { getCompletelySoldPositions } from "../institution/completelySold/service.js";
import { getInstitutionComparison } from "../institution/compare/service.js";
import {
  getPortfolioPerformanceProxyRankings,
  parseSortDir,
  parseSortKey,
} from "../institution/portfolioPerformanceProxy/index.js";

loadEnvFile();

const ROUTE_LIST_RE = /^\/api\/institutions\/?$/;
const ROUTE_PERFORMANCE_RANKINGS_RE = /^\/api\/institutions\/performance\/rankings\/?$/;
const ROUTE_PORTFOLIO_PROXY_RANKINGS_RE = /^\/api\/institutions\/performance-rankings\/?$/;
const ROUTE_MOST_ACCUMULATED_RE = /^\/api\/institutions\/most-accumulated\/?$/;
const ROUTE_NEW_POSITIONS_RE = /^\/api\/institutions\/new-positions\/?$/;
const ROUTE_COMPLETELY_SOLD_RE = /^\/api\/institutions\/completely-sold\/?$/;
const ROUTE_COMPARE_RE = /^\/api\/institutions\/compare\/?$/;
const ROUTE_CIK_RE =
  /^\/api\/institutions\/(\d+)(?:\/(holdings|activity|options|history|performance))?\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 120) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

function parseLimit(url: URL, fallback = 50): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : fallback;
}

export async function tryHandleInstitutions(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (ROUTE_LIST_RE.test(url.pathname)) {
    const funds = listTrackedInstitutions();
    json(res, 200, { funds, count: funds.length }, 3600);
    return true;
  }

  if (ROUTE_PERFORMANCE_RANKINGS_RE.test(url.pathname)) {
    const period = parsePerformancePeriod(url.searchParams.get("period"));
    try {
      const funds = listTrackedInstitutions();
      const service = getInstitutionPerformanceService();
      const payload = await service.getRankings(period, funds);
      json(res, 200, payload, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      if (message.includes("returns cache") || message.includes("warm-cache")) {
        json(res, 503, { error: "performance_cache_unavailable", message });
        return true;
      }
      json(res, 500, { error: "performance_rankings_error", message });
    }
    return true;
  }

  if (ROUTE_PORTFOLIO_PROXY_RANKINGS_RE.test(url.pathname)) {
    try {
      const { getPool } = await import("../db/pool.js");
      const pool = getPool();
      const num = (key: string): number | null => {
        const raw = url.searchParams.get(key);
        if (raw == null || raw === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };
      const payload = await getPortfolioPerformanceProxyRankings(
        {
          quarter: url.searchParams.get("quarter"),
          minPortfolioValue: num("minPortfolioValue"),
          minHoldings: num("minHoldings"),
          minGrowth1yPct: num("minGrowth1y"),
          minGrowth3yPct: num("minGrowth3y"),
          name: url.searchParams.get("name"),
          sort: parseSortKey(url.searchParams.get("sort")),
          sortDir: parseSortDir(url.searchParams.get("sortDir")),
          page: num("page") ?? 1,
          pageSize: num("pageSize") ?? num("limit") ?? 50,
        },
        pool
      );
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "portfolio_proxy_rankings_error", message });
    }
    return true;
  }

  if (ROUTE_MOST_ACCUMULATED_RE.test(url.pathname)) {
    const period = parseMostAccumulatedPeriod(url.searchParams.get("period"));
    try {
      const { getPool } = await import("../db/pool.js");
      const pool = getPool();
      const payload = await getMostAccumulatedPeriod(period, pool);
      json(res, 200, payload, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "most_accumulated_error", message });
    }
    return true;
  }

  if (ROUTE_NEW_POSITIONS_RE.test(url.pathname)) {
    try {
      const { getPool } = await import("../db/pool.js");
      const pool = getPool();
      const payload = await getNewInstitutionalPositions(pool);
      json(res, 200, payload, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "new_positions_error", message });
    }
    return true;
  }

  if (ROUTE_COMPLETELY_SOLD_RE.test(url.pathname)) {
    try {
      const { getPool } = await import("../db/pool.js");
      const pool = getPool();
      const payload = await getCompletelySoldPositions(pool);
      json(res, 200, payload, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "completely_sold_error", message });
    }
    return true;
  }

  if (ROUTE_COMPARE_RE.test(url.pathname)) {
    const cikA = url.searchParams.get("a") || url.searchParams.get("cikA");
    const cikB = url.searchParams.get("b") || url.searchParams.get("cikB");
    if (!cikA || !cikB) {
      json(res, 400, {
        error: "missing_params",
        message: "Provide institution CIKs via ?a=...&b=...",
      });
      return true;
    }
    try {
      const { getPool } = await import("../db/pool.js");
      const pool = getPool();
      const payload = await getInstitutionComparison(pool, cikA, cikB);
      if (!payload) {
        json(res, 404, { error: "not_found", message: "Unknown or untracked institution CIK" });
        return true;
      }
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      if (message.includes("different institutions")) {
        json(res, 400, { error: "invalid_compare", message });
        return true;
      }
      if (message.includes("no 13F holdings")) {
        json(res, 404, { error: "no_holdings", message });
        return true;
      }
      json(res, 500, { error: "compare_error", message });
    }
    return true;
  }

  const match = url.pathname.match(ROUTE_CIK_RE);
  if (!match) return false;

  const cik = resolveInstitutionCik(match[1]);
  if (!cik) {
    json(res, 404, { error: "not_found", message: "Unknown or untracked institution CIK" });
    return true;
  }

  const section = match[2] || "profile";
  const limit = parseLimit(url);

  try {
    const { getPool } = await import("../db/pool.js");
    const pool = getPool();

    if (section === "holdings") {
      const payload = await getInstitutionHoldings(pool, cik, limit);
      if (!payload) {
        json(res, 404, { error: "not_found", message: "Institution not found" });
        return true;
      }
      json(res, 200, payload);
      return true;
    }

    if (section === "activity") {
      const payload = await getInstitutionActivity(pool, cik, limit);
      if (!payload) {
        json(res, 404, { error: "not_found", message: "Institution not found" });
        return true;
      }
      json(res, 200, {
        meta: payload.meta,
        activity: payload.activity,
        adds: payload.adds,
        trims: payload.trims,
        newPositions: payload.newPositions,
        completelySold: payload.completelySold,
        previousPortfolioValueUsd: payload.previousPortfolioValueUsd,
      });
      return true;
    }

    if (section === "options") {
      const payload = await getInstitutionOptions(pool, cik, limit);
      if (!payload) {
        json(res, 404, { error: "not_found", message: "Institution not found" });
        return true;
      }
      json(res, 200, payload);
      return true;
    }

    if (section === "history") {
      const payload = await getInstitutionHistory(pool, cik, limit);
      if (!payload) {
        json(res, 404, { error: "not_found", message: "Institution not found" });
        return true;
      }
      json(res, 200, payload);
      return true;
    }

    if (section === "performance") {
      const meta = await loadInstitutionMeta(pool, cik);
      if (!meta) {
        json(res, 404, { error: "not_found", message: "Institution not found" });
        return true;
      }
      const service = getInstitutionPerformanceService();
      const series = await service.getPerformanceSeries(cik);
      const latest = series.length ? series[series.length - 1] : null;
      json(res, 200, {
        meta: {
          ...meta,
          asOfQuarter: latest?.quarter ?? meta.currentQuarter,
        },
        series,
        latest,
      });
      return true;
    }

    const meta = await loadInstitutionMeta(pool, cik);
    if (!meta) {
      json(res, 404, { error: "not_found", message: "Institution not found" });
      return true;
    }
    json(res, 200, { meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    if (message.includes("returns cache") || message.includes("warm-cache")) {
      json(res, 503, { error: "performance_cache_unavailable", message });
      return true;
    }
    json(res, 500, { error: "institution_query_error", message });
  }

  return true;
}

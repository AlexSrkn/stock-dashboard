import type http from "node:http";
import { loadEnvFile, getPool } from "../db/pool.js";
import { parseClusterLookbackDays } from "../insiderCluster/clusterService.js";
import { loadExecutiveInsiderAccumulation } from "../stocks/executiveInsiderAccumulation.js";
import { loadInstitutionalShareAccumulation } from "../stocks/institutionalAccumulation.js";
import { loadSp500 } from "../stocks/sp500.js";
import {
  loadFreeCashFlowLeaders,
  loadHighMarginStocks,
  loadRevenueGrowthLeaders,
} from "../stocks/fundamentalsRankings.js";

loadEnvFile();

const ROUTE_SP500_RE = /^\/api\/stocks\/sp500\/?$/;
const ROUTE_INST_ACCUM_RE = /^\/api\/stocks\/institutional-accumulation\/?$/;
const ROUTE_EXEC_INSIDER_RE = /^\/api\/stocks\/executive-insider-accumulation\/?$/;
const ROUTE_REV_GROWTH_RE = /^\/api\/stocks\/revenue-growth-leaders\/?$/;
const ROUTE_FCF_LEADERS_RE = /^\/api\/stocks\/fcf-leaders\/?$/;
const ROUTE_HIGH_MARGIN_RE = /^\/api\/stocks\/high-margin\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 300) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

function parseLimit(url: URL, fallback = 100): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : fallback;
}

function parseSector(url: URL): string | null {
  const raw = url.searchParams.get("sector");
  if (!raw) return null;
  const value = raw.trim();
  return value || null;
}

function rankingOptions(url: URL, defaultLimit: number) {
  return {
    limit: parseLimit(url, defaultLimit),
    sector: parseSector(url),
  };
}

export async function tryHandleStocksHub(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (ROUTE_SP500_RE.test(url.pathname)) {
    try {
      json(res, 200, loadSp500(), 86_400);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: "sp500_error", message });
    }
    return true;
  }

  if (ROUTE_INST_ACCUM_RE.test(url.pathname)) {
    try {
      const payload = await loadInstitutionalShareAccumulation(getPool(), parseLimit(url));
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "institutional_accumulation_error", message });
    }
    return true;
  }

  if (ROUTE_EXEC_INSIDER_RE.test(url.pathname)) {
    try {
      const lookbackDays = parseClusterLookbackDays(url.searchParams.get("window"));
      const payload = await loadExecutiveInsiderAccumulation(
        lookbackDays,
        getPool(),
        parseLimit(url)
      );
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "executive_insider_accumulation_error", message });
    }
    return true;
  }

  if (ROUTE_REV_GROWTH_RE.test(url.pathname)) {
    try {
      const payload = await loadRevenueGrowthLeaders(getPool(), rankingOptions(url, 200));
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "revenue_growth_leaders_error", message });
    }
    return true;
  }

  if (ROUTE_FCF_LEADERS_RE.test(url.pathname)) {
    try {
      const payload = await loadFreeCashFlowLeaders(getPool(), rankingOptions(url, 200));
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "fcf_leaders_error", message });
    }
    return true;
  }

  if (ROUTE_HIGH_MARGIN_RE.test(url.pathname)) {
    try {
      const payload = await loadHighMarginStocks(getPool(), rankingOptions(url, 200));
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "high_margin_error", message });
    }
    return true;
  }

  return false;
}

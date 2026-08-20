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

const SELECT_STOCK_CLASSIFICATION_SQL = `
SELECT
  UPPER(BTRIM(ticker)) AS ticker,
  company_name,
  sector,
  industry
FROM stocks
WHERE ticker = ANY($1::varchar[])
`.trim();

async function lookupStockClassifications(
  tickers: string[]
): Promise<Map<string, { companyName: string | null; sector: string | null; industry: string | null }>> {
  const unique = [...new Set(tickers.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, { companyName: string | null; sector: string | null; industry: string | null }>();
  if (!unique.length) return out;
  try {
    const res = await getPool().query<{
      ticker: string;
      company_name: string | null;
      sector: string | null;
      industry: string | null;
    }>(SELECT_STOCK_CLASSIFICATION_SQL, [unique]);
    for (const row of res.rows) {
      out.set(String(row.ticker).toUpperCase(), {
        companyName: row.company_name ? String(row.company_name) : null,
        sector: row.sector ? String(row.sector) : null,
        industry: row.industry ? String(row.industry) : null,
      });
    }
  } catch {
    /* classification is optional when stocks table is empty */
  }
  return out;
}

function attachClassification<T>(
  item: T,
  ticker: string,
  lookup: Map<string, { companyName: string | null; sector: string | null; industry: string | null }>
): T & { sector: string | null; industry: string | null; companyName: string | null } {
  const hit = lookup.get(String(ticker || "").trim().toUpperCase());
  return {
    ...item,
    sector: hit?.sector ?? null,
    industry: hit?.industry ?? null,
    companyName: hit?.companyName ?? null,
  };
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
      const payload = loadSp500();
      const lookup = await lookupStockClassifications(payload.stocks.map((s) => s.symbol));
      json(
        res,
        200,
        {
          ...payload,
          stocks: payload.stocks.map((s) => attachClassification(s, s.symbol, lookup)),
        },
        86_400
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: "sp500_error", message });
    }
    return true;
  }

  if (ROUTE_INST_ACCUM_RE.test(url.pathname)) {
    try {
      const payload = await loadInstitutionalShareAccumulation(getPool(), parseLimit(url));
      const lookup = await lookupStockClassifications(payload.stocks.map((s) => s.ticker));
      json(res, 200, {
        ...payload,
        stocks: payload.stocks.map((s) => attachClassification(s, s.ticker, lookup)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      if (
        message.includes("warm-institutional-accumulation") ||
        message.includes("cache not ready")
      ) {
        json(res, 503, { error: "institutional_accumulation_cache_unavailable", message });
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
      const lookup = await lookupStockClassifications(payload.stocks.map((s) => s.ticker));
      json(res, 200, {
        ...payload,
        stocks: payload.stocks.map((s) => attachClassification(s, s.ticker, lookup)),
      });
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

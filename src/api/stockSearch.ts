import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { searchStocks } from "../services/stockSearch.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/stocks\/search\/?$/;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 60) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

function parseLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(n)));
}

/**
 * GET /api/stocks/search?q=apple&limit=20
 *
 * Local SEC-backed symbol search. Returns a Yahoo-compatible result shape so it
 * is a drop-in replacement for the previous /api/symbols endpoint.
 */
export async function tryHandleStockSearch(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (!ROUTE_RE.test(url.pathname)) return false;

  const q = (url.searchParams.get("q") || "").trim();
  const limit = parseLimit(url);

  try {
    const matches = q ? await searchStocks(q, { limit }) : [];
    const results = matches.map((m) => ({
      symbol: m.ticker,
      description: m.companyName || m.ticker,
      name: m.companyName || m.ticker,
      exchange: "",
      type: "EQUITY",
      cik: m.cik,
    }));
    json(res, 200, { results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "stock_search_error", message });
  }

  return true;
}

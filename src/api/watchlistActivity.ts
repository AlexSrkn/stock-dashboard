import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getWatchlistActivityForTickers } from "../stocks/watchlistActivity.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/watchlist\/activity\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 30) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

/**
 * GET /api/watchlist/activity?tickers=AAPL,NVDA
 * Notification chips (insider / Congress / institution) + signal labels.
 */
export async function tryHandleWatchlistActivity(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (!ROUTE_RE.test(url.pathname)) return false;

  const raw = url.searchParams.get("tickers") || url.searchParams.get("symbols") || "";
  const tickers = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (!tickers.length) {
    json(res, 400, { error: "missing_tickers", message: "Pass tickers=AAPL,NVDA" }, 0);
    return true;
  }

  try {
    const rows = await getWatchlistActivityForTickers(tickers);
    json(res, 200, { rows, count: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
      json(res, 503, { error: "database_unavailable", message }, 0);
      return true;
    }
    json(res, 500, { error: "watchlist_activity_error", message }, 0);
  }
  return true;
}

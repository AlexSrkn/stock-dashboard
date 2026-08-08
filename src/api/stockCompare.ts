import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getStockCompare, StockCompareError } from "../stocks/compare/service.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/stocks\/compare\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 120) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleStockCompare(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (!ROUTE_RE.test(url.pathname)) return false;

  try {
    const payload = await getStockCompare(url);
    json(res, 200, payload);
  } catch (err) {
    if (err instanceof StockCompareError) {
      json(res, err.status, { error: err.code, message: err.message }, 0);
      return true;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message }, 0);
      return true;
    }
    json(res, 500, { error: "stock_compare_error", message }, 0);
  }
  return true;
}

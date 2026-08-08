import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { computeStockSignals } from "../stocks/stockSignals.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/stocks\/([^/]+)\/signals\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, max-age=300",
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleStockSignals(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const match = url.pathname.match(ROUTE_RE);
  if (!match) return false;

  const ticker = decodeURIComponent(match[1]).trim().toUpperCase();
  if (!ticker) {
    json(res, 400, { error: "missing_ticker" });
    return true;
  }

  try {
    const payload = await computeStockSignals(ticker);
    json(res, 200, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    if (message.includes("Unknown ticker")) {
      json(res, 404, { error: "not_found", message });
      return true;
    }
    json(res, 500, { error: "signals_error", message });
  }

  return true;
}

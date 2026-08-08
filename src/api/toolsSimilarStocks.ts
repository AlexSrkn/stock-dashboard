import type http from "node:http";
import { loadEnvFile, getPool } from "../db/pool.js";
import { getSimilarStocks, SimilarStocksError } from "../tools/similarStocks/index.js";

loadEnvFile();

const GET_RE = /^\/api\/tools\/similar-stocks\/([^/]+)\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 0) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheSeconds ? `private, max-age=${cacheSeconds}` : "private, no-cache",
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleToolsSimilarStocks(
  url: URL,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const match = url.pathname.match(GET_RE);
  if (!match || (_req.method !== "GET" && _req.method !== "HEAD")) return false;
  const ticker = decodeURIComponent(match[1]);

  try {
    const payload = await getSimilarStocks(ticker, url, getPool());
    json(res, 200, payload, 60);
  } catch (err) {
    if (err instanceof SimilarStocksError) {
      json(res, err.status, { error: err.code, message: err.message });
      return true;
    }
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: "similar_stocks_error", message });
  }
  return true;
}

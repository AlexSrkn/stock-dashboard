import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import {
  getDoubleSignalService,
  parseDoubleSignalWindowDays,
} from "../signals/doubleSignal/doubleSignalService.js";

loadEnvFile();

const ROUTE_LIST_RE = /^\/api\/signals\/double-signal\/?$/;
const ROUTE_TICKER_RE = /^\/api\/signals\/double-signal\/([^/]+)\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 300) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleDoubleSignal(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const service = getDoubleSignalService();
  const windowDays = parseDoubleSignalWindowDays(url.searchParams.get("window"));

  if (ROUTE_LIST_RE.test(url.pathname)) {
    try {
      const payload = await service.getPayload(windowDays);
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "double_signal_error", message });
    }
    return true;
  }

  const tickerMatch = url.pathname.match(ROUTE_TICKER_RE);
  if (tickerMatch) {
    const ticker = decodeURIComponent(tickerMatch[1]);
    try {
      const detail = await service.getDetail(ticker, windowDays);
      if (!detail) {
        json(res, 404, {
          error: "not_found",
          message: `No double signal for ${ticker.toUpperCase()} (${windowDays}d window)`,
        });
        return true;
      }
      json(res, 200, detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "double_signal_error", message });
    }
    return true;
  }

  return false;
}

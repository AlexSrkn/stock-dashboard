import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getSmartMoneyService } from "../smartMoney/smartMoneyService.js";

loadEnvFile();

const ROUTE_LIST_RE = /^\/api\/smart-money\/scores\/?$/;
const ROUTE_TICKER_RE = /^\/api\/stocks\/([^/]+)\/smart-money-score\/?$/;

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

export async function tryHandleSmartMoney(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const service = getSmartMoneyService();

  if (ROUTE_LIST_RE.test(url.pathname)) {
    try {
      const limit = parseLimit(url);
      const payload = await service.getAllScores(limit);
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "smart_money_error", message });
    }
    return true;
  }

  const tickerMatch = url.pathname.match(ROUTE_TICKER_RE);
  if (tickerMatch) {
    const ticker = decodeURIComponent(tickerMatch[1]);
    try {
      const score = await service.getScoreForTicker(ticker);
      if (!score) {
        json(res, 404, {
          error: "not_found",
          message: `No smart money score for ${ticker.toUpperCase()}`,
        });
        return true;
      }
      json(res, 200, { ticker: ticker.toUpperCase(), ...score });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "smart_money_error", message });
    }
    return true;
  }

  return false;
}

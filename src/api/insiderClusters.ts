import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import {
  getInsiderClusterService,
  parseClusterLookbackDays,
} from "../insiderCluster/clusterService.js";

loadEnvFile();

const ROUTE_LIST_RE = /^\/api\/insider-clusters\/?$/;
const ROUTE_TICKER_RE = /^\/api\/stocks\/([^/]+)\/insider-cluster\/?$/;

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

export async function tryHandleInsiderClusters(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const service = getInsiderClusterService();
  const lookbackDays = parseClusterLookbackDays(url.searchParams.get("window"));

  if (ROUTE_LIST_RE.test(url.pathname)) {
    try {
      const alertsOnly = url.searchParams.get("alerts") === "1";
      const payload = await service.getAllSignals(lookbackDays, {
        limit: parseLimit(url),
        alertsOnly,
      });
      json(res, 200, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "insider_cluster_error", message });
    }
    return true;
  }

  const tickerMatch = url.pathname.match(ROUTE_TICKER_RE);
  if (tickerMatch) {
    const ticker = decodeURIComponent(tickerMatch[1]);
    try {
      const signal = await service.getForTicker(ticker, lookbackDays);
      if (!signal) {
        json(res, 404, {
          error: "not_found",
          message: `No insider cluster signal for ${ticker.toUpperCase()} (${lookbackDays}d window)`,
        });
        return true;
      }
      json(res, 200, { ticker: ticker.toUpperCase(), ...signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "insider_cluster_error", message });
    }
    return true;
  }

  return false;
}

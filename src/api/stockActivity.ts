import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getRecentlyActiveStocks } from "../stocks/recentlyActive.js";
import { getStocksMostAccumulated } from "../stocks/mostAccumulated/compute.js";
import { getOwnershipChanges } from "../stocks/ownershipChanges/service.js";
import { getHolderOverlap } from "../stocks/holderOverlap/service.js";
import { getOwnershipHistory } from "../stocks/ownershipHistory/service.js";

loadEnvFile();

const ROUTE_RECENTLY_ACTIVE_RE = /^\/api\/stocks\/recently-active\/?$/;
const ROUTE_MOST_ACCUMULATED_RE = /^\/api\/stocks\/most-accumulated\/?$/;
const ROUTE_OWNERSHIP_CHANGES_RE = /^\/api\/stocks\/ownership-changes\/?$/;
const ROUTE_HOLDER_OVERLAP_RE = /^\/api\/stocks\/holder-overlap\/?$/;
const ROUTE_OWNERSHIP_HISTORY_RE = /^\/api\/stocks\/ownership-history\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 120) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleStockActivity(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (ROUTE_MOST_ACCUMULATED_RE.test(url.pathname)) {
    try {
      const payload = await getStocksMostAccumulated(url);
      json(res, 200, payload, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      if (message.includes("warm-most-accumulated") || message.includes("cache not ready")) {
        json(res, 503, { error: "most_accumulated_cache_unavailable", message });
        return true;
      }
      json(res, 500, { error: "stocks_most_accumulated_error", message });
    }
    return true;
  }

  if (ROUTE_OWNERSHIP_CHANGES_RE.test(url.pathname)) {
    try {
      const payload = await getOwnershipChanges(url);
      json(res, 200, payload, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "ownership_changes_error", message });
    }
    return true;
  }

  if (ROUTE_HOLDER_OVERLAP_RE.test(url.pathname)) {
    try {
      const payload = await getHolderOverlap(url);
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "holder_overlap_error", message });
    }
    return true;
  }

  if (ROUTE_OWNERSHIP_HISTORY_RE.test(url.pathname)) {
    try {
      const payload = await getOwnershipHistory(url);
      json(res, 200, payload, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "ownership_history_error", message });
    }
    return true;
  }

  if (!ROUTE_RECENTLY_ACTIVE_RE.test(url.pathname)) return false;

  try {
    const payload = await getRecentlyActiveStocks(url);
    json(res, 200, payload, 300);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "stock_activity_error", message });
  }

  return true;
}

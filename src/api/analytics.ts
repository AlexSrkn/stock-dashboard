import type http from "node:http";
import { loadEnvFile, getPool } from "../db/pool.js";
import {
  loadInstitutionalSectorFlows,
  loadInstitutionalSectorOwnership,
  loadSectorSummaries,
} from "../stocks/sectorAnalytics.js";

loadEnvFile();

const ROUTE_SECTORS_RE = /^\/api\/analytics\/sectors\/?$/;
const ROUTE_SECTOR_OWNERSHIP_RE = /^\/api\/analytics\/institutional-sector-ownership\/?$/;
const ROUTE_SECTOR_FLOWS_RE = /^\/api\/analytics\/institutional-sector-flows\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 300) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleAnalytics(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (
    !ROUTE_SECTORS_RE.test(url.pathname) &&
    !ROUTE_SECTOR_OWNERSHIP_RE.test(url.pathname) &&
    !ROUTE_SECTOR_FLOWS_RE.test(url.pathname)
  ) {
    return false;
  }

  try {
    if (ROUTE_SECTORS_RE.test(url.pathname)) {
      json(res, 200, await loadSectorSummaries(getPool()));
      return true;
    }
    if (ROUTE_SECTOR_OWNERSHIP_RE.test(url.pathname)) {
      json(res, 200, await loadInstitutionalSectorOwnership(getPool()));
      return true;
    }
    if (ROUTE_SECTOR_FLOWS_RE.test(url.pathname)) {
      json(res, 200, await loadInstitutionalSectorFlows(getPool()));
      return true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "analytics_error", message });
    return true;
  }

  return false;
}

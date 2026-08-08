import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getOwnershipService } from "../ownership/ownershipService.js";
import { OwnershipResolveError } from "../ownership/resolveStock.js";
import type { OwnershipEndpoint } from "../ownership/ownershipService.js";

loadEnvFile();

const ENDPOINTS = new Set<OwnershipEndpoint>([
  "top-holders",
  "ownership-changes",
  "new-positions",
  "sold-out",
  "institutional-options",
  "institutional-transactions",
]);

const ROUTE_RE =
  /^\/api\/stocks\/([^/]+)\/(top-holders|ownership-changes|new-positions|sold-out|institutional-options|institutional-transactions)\/?$/;

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  cacheSeconds = 120
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

function parseLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseQuarters(url: URL): number | undefined {
  const raw = url.searchParams.get("quarters");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Handle stock ownership API routes. Returns true if the request was handled.
 */
export async function tryHandleStockOwnership(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const match = url.pathname.match(ROUTE_RE);
  if (!match) return false;

  const ticker = decodeURIComponent(match[1]);
  const endpoint = match[2] as OwnershipEndpoint;
  if (!ENDPOINTS.has(endpoint)) {
    json(res, 404, { error: "not_found", message: "Unknown ownership endpoint" });
    return true;
  }

  try {
    const service = getOwnershipService();
    const payload = await service.query(endpoint, ticker, {
      limit: parseLimit(url),
      quarters: parseQuarters(url),
    });
    json(res, 200, payload);
  } catch (err) {
    if (err instanceof OwnershipResolveError) {
      json(res, err.statusCode, { error: "ownership_resolve_error", message: err.message });
      return true;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "ownership_query_error", message });
  }

  return true;
}

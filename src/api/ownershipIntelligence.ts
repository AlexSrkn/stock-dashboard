import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getOwnershipIntelligence } from "../ownership/ownershipIntelligence.js";
import { OwnershipResolveError } from "../ownership/resolveStock.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/stocks\/([^/]+)\/ownership-intelligence\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 120) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleOwnershipIntelligence(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const match = url.pathname.match(ROUTE_RE);
  if (!match) return false;

  const ticker = decodeURIComponent(match[1]);

  try {
    const payload = await getOwnershipIntelligence(ticker);
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
    json(res, 500, { error: "ownership_intelligence_error", message });
  }

  return true;
}

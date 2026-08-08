import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getInsiderTransactions } from "../insider/insiderAnalytics.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/stocks\/([^/]+)\/insider-transactions\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 120) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

function parseQuery(url: URL) {
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw != null ? Number(limitRaw) : undefined;

  const signalRaw = url.searchParams.get("signal");
  const signal =
    signalRaw === "high" || signalRaw === "low" || signalRaw === "all" ? signalRaw : undefined;

  const codesRaw = url.searchParams.get("codes") || url.searchParams.get("code");
  const codes = codesRaw
    ? codesRaw
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    : undefined;

  const roleRaw = url.searchParams.get("role");
  const role =
    roleRaw === "ceo" || roleRaw === "director" || roleRaw === "officer" || roleRaw === "all"
      ? roleRaw
      : undefined;

  const sortRaw = url.searchParams.get("sort");
  const sort = sortRaw === "value" || sortRaw === "date" ? sortRaw : undefined;

  return {
    limit,
    signal: signal as "high" | "low" | "all" | undefined,
    codes,
    role: role as "ceo" | "director" | "officer" | "all" | undefined,
    sort: sort as "date" | "value" | undefined,
  };
}

export async function tryHandleStockInsider(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const match = url.pathname.match(ROUTE_RE);
  if (!match) return false;

  const ticker = decodeURIComponent(match[1]);

  try {
    const payload = await getInsiderTransactions(ticker, parseQuery(url));
    json(res, 200, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "insider_query_error", message });
  }

  return true;
}

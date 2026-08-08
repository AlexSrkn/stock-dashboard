import type http from "node:http";
import { getRecentInsiderTransactions } from "../insider/insiderAnalytics.js";
import { getConvictionBuys } from "../insider/convictionBuys/service.js";
import { getRepeatBuyers } from "../insider/repeatBuyers/service.js";
import { getInsiderSentiment } from "../insider/sentiment/service.js";
import { getFirstTimeBuyers } from "../insider/firstTimeBuyers/service.js";
import { getHeavySelling } from "../insider/heavySelling/service.js";

const ROUTE_RECENT_RE = /^\/api\/insiders\/recent\/?$/;
const ROUTE_CONVICTION_BUYS_RE = /^\/api\/insiders\/conviction-buys\/?$/;
const ROUTE_REPEAT_BUYERS_RE = /^\/api\/insiders\/repeat-buyers\/?$/;
const ROUTE_SENTIMENT_RE = /^\/api\/insiders\/sentiment\/?$/;
const ROUTE_FIRST_TIME_BUYERS_RE = /^\/api\/insiders\/first-time-buyers\/?$/;
const ROUTE_HEAVY_SELLING_RE = /^\/api\/insiders\/heavy-selling\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 60) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

function parseLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  const n = raw != null ? Number(raw) : 500;
  return Number.isFinite(n) ? Math.min(1000, Math.max(1, n)) : 500;
}

function parseSignal(url: URL): "high" | "low" | "all" | undefined {
  const raw = url.searchParams.get("signal");
  return raw === "high" || raw === "low" || raw === "all" ? raw : undefined;
}

export async function tryHandleInsiders(url: URL, res: http.ServerResponse): Promise<boolean> {
  if (ROUTE_HEAVY_SELLING_RE.test(url.pathname)) {
    try {
      const payload = await getHeavySelling(url);
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "heavy_selling_error", message });
    }
    return true;
  }

  if (ROUTE_FIRST_TIME_BUYERS_RE.test(url.pathname)) {
    try {
      const payload = await getFirstTimeBuyers(url);
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "first_time_buyers_error", message });
    }
    return true;
  }

  if (ROUTE_SENTIMENT_RE.test(url.pathname)) {
    try {
      const payload = await getInsiderSentiment(url);
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "insider_sentiment_error", message });
    }
    return true;
  }

  if (ROUTE_REPEAT_BUYERS_RE.test(url.pathname)) {
    try {
      const payload = await getRepeatBuyers(url);
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "repeat_buyers_error", message });
    }
    return true;
  }

  if (ROUTE_CONVICTION_BUYS_RE.test(url.pathname)) {
    try {
      const payload = await getConvictionBuys(url);
      json(res, 200, payload, 120);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("DATABASE_URL")) {
        json(res, 503, { error: "database_unavailable", message });
        return true;
      }
      json(res, 500, { error: "conviction_buys_error", message });
    }
    return true;
  }

  if (!ROUTE_RECENT_RE.test(url.pathname)) return false;

  try {
    const payload = await getRecentInsiderTransactions({
      limit: parseLimit(url),
      signal: parseSignal(url) ?? "all",
      sort: "date",
    });
    json(res, 200, payload, 60);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "insider_recent_error", message });
  }

  return true;
}

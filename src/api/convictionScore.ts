import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getConvictionScore } from "../signals/convictionScore/service.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/signals\/conviction-score\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 300) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleConvictionScore(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (!ROUTE_RE.test(url.pathname)) return false;

  try {
    const payload = await getConvictionScore(url);
    json(res, 200, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "conviction_score_error", message });
  }
  return true;
}

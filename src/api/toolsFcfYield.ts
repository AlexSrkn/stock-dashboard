import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { SecHttpError } from "../sec/http.js";
import {
  FcfYieldToolsError,
  getFcfYieldInputs,
  runFcfYieldCalculate,
} from "../tools/fcfyield/index.js";

loadEnvFile();

const GET_RE = /^\/api\/tools\/fcf-yield\/([^/]+)\/?$/;
const CALC_RE = /^\/api\/tools\/fcf-yield\/calculate\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 0) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheSeconds ? `private, max-age=${cacheSeconds}` : "private, no-cache",
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new FcfYieldToolsError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export async function tryHandleToolsFcfYield(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (CALC_RE.test(url.pathname) && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      json(res, 200, runFcfYieldCalculate(body));
    } catch (err) {
      if (err instanceof FcfYieldToolsError) {
        json(res, err.status, { error: err.code, message: err.message });
        return true;
      }
      const message = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: "fcf_yield_calculate_error", message });
    }
    return true;
  }

  const match = url.pathname.match(GET_RE);
  if (!match || req.method !== "GET") return false;
  const ticker = decodeURIComponent(match[1]);
  if (ticker.toLowerCase() === "calculate") return false;

  try {
    const payload = await getFcfYieldInputs(ticker);
    json(res, 200, payload, 300);
  } catch (err) {
    if (err instanceof FcfYieldToolsError) {
      json(res, err.status, { error: err.code, message: err.message });
      return true;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof SecHttpError) {
      const status = err.statusCode === 404 ? 404 : err.statusCode >= 500 ? 502 : err.statusCode;
      json(res, status, { error: "sec_financials_error", message });
      return true;
    }
    if (message.includes("SEC_USER_AGENT")) {
      json(res, 503, { error: "sec_unavailable", message });
      return true;
    }
    json(res, 500, { error: "fcf_yield_inputs_error", message });
  }
  return true;
}

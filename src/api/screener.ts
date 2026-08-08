import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { getFilterCatalog } from "../services/screener/FilterCatalog.js";
import { runScreener } from "../services/screener/ScreenerService.js";
import { searchInstitutions } from "../services/ownership/OwnershipSearch.js";
import {
  ScreenerValidationError,
  type ScreenerRequest,
} from "../services/screener/FilterTypes.js";

loadEnvFile();

const ROUTE_SCREENER = /^\/api\/screener\/?$/;
const ROUTE_FILTERS = /^\/api\/screener\/filters\/?$/;
const ROUTE_INSTITUTIONS = /^\/api\/screener\/institutions\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 0) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : "no-store",
  });
  res.end(JSON.stringify(body));
}

function handleError(res: http.ServerResponse, err: unknown) {
  if (err instanceof ScreenerValidationError) {
    json(res, 400, { error: "invalid_filters", message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
    json(res, 503, { error: "database_unavailable", message });
    return;
  }
  json(res, 500, { error: "screener_error", message });
}

function parseRequestFromQuery(url: URL): ScreenerRequest {
  const rawFilters = url.searchParams.get("filters");
  let filters: ScreenerRequest["filters"] = [];
  if (rawFilters) {
    try {
      const parsed = JSON.parse(rawFilters);
      filters = Array.isArray(parsed) ? parsed : parsed.filters ?? [];
    } catch {
      throw new ScreenerValidationError("`filters` query param must be valid JSON");
    }
  }
  const num = (key: string): number | undefined => {
    const v = url.searchParams.get(key);
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return { filters, limit: num("limit"), offset: num("offset"), insiderWindowDays: num("insiderWindowDays") };
}

/** GET routes: `/api/screener` (filters as JSON query) and `/api/screener/filters` (catalog). */
export async function tryHandleScreener(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (ROUTE_FILTERS.test(url.pathname)) {
    try {
      json(res, 200, await getFilterCatalog(), 300);
    } catch (err) {
      handleError(res, err);
    }
    return true;
  }

  if (ROUTE_INSTITUTIONS.test(url.pathname)) {
    try {
      const q = url.searchParams.get("q") || "";
      const limit = Number(url.searchParams.get("limit") || "20") || 20;
      json(res, 200, { results: await searchInstitutions(q, undefined, limit) }, 60);
    } catch (err) {
      handleError(res, err);
    }
    return true;
  }

  if (!ROUTE_SCREENER.test(url.pathname)) return false;

  try {
    const request = parseRequestFromQuery(url);
    json(res, 200, await runScreener(request));
  } catch (err) {
    handleError(res, err);
  }
  return true;
}

/** POST `/api/screener` with a JSON body `{ filters, limit?, offset?, sort?, insiderWindowDays? }`. */
export async function handleScreenerPost(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const request: ScreenerRequest = {
      filters: Array.isArray(body?.filters) ? body.filters : [],
      limit: typeof body?.limit === "number" ? body.limit : undefined,
      offset: typeof body?.offset === "number" ? body.offset : undefined,
      sort: body?.sort,
      insiderWindowDays:
        typeof body?.insiderWindowDays === "number" ? body.insiderWindowDays : undefined,
    };
    json(res, 200, await runScreener(request));
  } catch (err) {
    handleError(res, err);
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new ScreenerValidationError("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ScreenerValidationError("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

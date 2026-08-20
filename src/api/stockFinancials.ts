import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { SecHttpError } from "../sec/http.js";
import { getFilingsFundamentals } from "../sec/financials/financialsService.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/stocks\/([^/]+)\/filings-fundamentals\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-cache",
  });
  res.end(JSON.stringify(body));
}

function parseLimit(url: URL, key: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(key);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.round(n)));
}

export async function tryHandleStockFinancials(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const match = url.pathname.match(ROUTE_RE);
  if (!match) return false;

  const ticker = decodeURIComponent(match[1]);

  try {
    const payload = await getFilingsFundamentals(ticker, {
      annualFilingLimit: parseLimit(url, "annualFilings", 8, 40),
      quarterlyFilingLimit: parseLimit(url, "quarterlyFilings", 12, 40),
      currentFilingLimit: parseLimit(url, "currentFilings", 20, 40),
      annualPeriodLimit: parseLimit(url, "annualPeriods", 5, 20),
      quarterlyPeriodLimit: parseLimit(url, "quarterlyPeriods", 8, 24),
    });
    json(res, 200, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unknown ticker")) {
      json(res, 404, { error: "not_found", message });
      return true;
    }
    if (err instanceof SecHttpError) {
      const status = err.statusCode === 404 ? 404 : err.statusCode >= 500 ? 502 : err.statusCode;
      // Prefer a short message — raw SEC XML bodies are noisy in the UI.
      const message =
        err.statusCode === 404 && !err.message.includes("No SEC Company Facts")
          ? `No SEC Company Facts XBRL available for ${ticker.toUpperCase()}.`
          : err.message.replace(/\s+/g, " ").trim().slice(0, 280);
      json(res, status, { error: "sec_financials_error", message });
      return true;
    }
    if (message.includes("SEC_USER_AGENT")) {
      json(res, 503, { error: "sec_unavailable", message });
      return true;
    }
    json(res, 500, { error: "filings_fundamentals_error", message });
  }

  return true;
}

import type http from "node:http";
import { loadEnvFile } from "../db/pool.js";
import { classifyTickerFromSec } from "../stocks/stockClassificationService.js";
import { getStocksRepository } from "../stocks/stocksRepository.js";

loadEnvFile();

const ROUTE_RE = /^\/api\/stocks\/([^/]+)\/classification\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, max-age=3600",
  });
  res.end(JSON.stringify(body));
}

export async function tryHandleStockClassification(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const match = url.pathname.match(ROUTE_RE);
  if (!match) return false;

  const ticker = decodeURIComponent(match[1]).trim().toUpperCase();
  if (!ticker) {
    json(res, 400, { error: "missing_ticker" });
    return true;
  }

  try {
    await getStocksRepository().ensureSchema();
    let row = await getStocksRepository().getByTicker(ticker);
    if (!row?.sector) {
      const classified = await classifyTickerFromSec(ticker);
      if (classified.ok) {
        row = await getStocksRepository().getByTicker(ticker);
      }
    }

    json(res, 200, {
      ticker,
      companyName: row?.companyName ?? null,
      sector: row?.sector ?? null,
      industry: row?.industry ?? null,
      sic: row?.sic ?? null,
      sicDescription: row?.sicDescription ?? null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    if (message.includes("Unknown ticker")) {
      json(res, 404, { error: "not_found", message });
      return true;
    }
    json(res, 500, { error: "classification_error", message });
  }

  return true;
}

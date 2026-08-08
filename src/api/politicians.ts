import type http from "node:http";
import { getCongressBuysForTicker, normalizeTicker } from "../politicians/byTicker.js";
import { readPoliticiansRecent } from "../politicians/recent.js";
import {
  getPoliticianLargestPortfolios,
  getPoliticianMostAccumulated,
  getPoliticianProfileSectorExposure,
  getPoliticianSectorDetail,
  getPoliticianSectorExposure,
  parsePoliticianAnalyticsPeriod,
  parsePoliticianChamberFilter,
} from "../politicians/analytics/service.js";
import { getPoliticianRepeatBuyers } from "../politicians/repeatBuyers/service.js";
import { getPoliticianFirstTimeBuyers } from "../politicians/firstTimeBuyers/service.js";
import { getPoliticianHeavySelling } from "../politicians/heavySelling/service.js";

const ROUTE_RECENT_RE = /^\/api\/politicians\/recent\/?$/;
const ROUTE_MOST_ACCUMULATED_RE = /^\/api\/politicians\/most-accumulated\/?$/;
const ROUTE_LARGEST_PORTFOLIOS_RE = /^\/api\/politicians\/largest-portfolios\/?$/;
const ROUTE_REPEAT_BUYERS_RE = /^\/api\/politicians\/repeat-buyers\/?$/;
const ROUTE_FIRST_TIME_BUYERS_RE = /^\/api\/politicians\/first-time-buyers\/?$/;
const ROUTE_HEAVY_SELLING_RE = /^\/api\/politicians\/heavy-selling\/?$/;
const ROUTE_SECTOR_EXPOSURE_RE = /^\/api\/politicians\/sector-exposure\/?$/;
const ROUTE_SECTOR_EXPOSURE_DETAIL_RE = /^\/api\/politicians\/sector-exposure\/([^/]+)\/?$/;
const ROUTE_PROFILE_SECTOR_RE = /^\/api\/politicians\/profile\/([^/]+)\/sector-exposure\/?$/;
const ROUTE_STOCK_CONGRESS_RE = /^\/api\/stocks\/([^/]+)\/congress-activity\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 60) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

export async function tryHandlePoliticians(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const stockMatch = url.pathname.match(ROUTE_STOCK_CONGRESS_RE);
  if (stockMatch) {
    const ticker = normalizeTicker(decodeURIComponent(stockMatch[1]));
    const { fetchedAt, trades } = getCongressBuysForTicker(ticker);
    if (!readPoliticiansRecent()) {
      json(res, 404, {
        error: "not_found",
        message: "No politician data yet. Run: npm run politicians:fetch-recent",
      });
      return true;
    }
    json(
      res,
      200,
      {
        meta: { ticker, count: trades.length, fetchedAt },
        trades,
      },
      120
    );
    return true;
  }

  if (!ROUTE_RECENT_RE.test(url.pathname)) {
    const profileSectorMatch = url.pathname.match(ROUTE_PROFILE_SECTOR_RE);
    if (profileSectorMatch) {
      const period = parsePoliticianAnalyticsPeriod(url.searchParams.get("period"));
      const chamber = parsePoliticianChamberFilter(url.searchParams.get("chamber"));
      const key = decodeURIComponent(profileSectorMatch[1]);
      json(res, 200, await getPoliticianProfileSectorExposure(key, period, chamber), 120);
      return true;
    }

    const sectorDetailMatch = url.pathname.match(ROUTE_SECTOR_EXPOSURE_DETAIL_RE);
    if (sectorDetailMatch) {
      const sectorSlug = decodeURIComponent(sectorDetailMatch[1]);
      json(res, 200, await getPoliticianSectorDetail(url, sectorSlug), 120);
      return true;
    }

    if (ROUTE_SECTOR_EXPOSURE_RE.test(url.pathname)) {
      json(res, 200, await getPoliticianSectorExposure(url), 120);
      return true;
    }

    if (ROUTE_MOST_ACCUMULATED_RE.test(url.pathname)) {
      const period = parsePoliticianAnalyticsPeriod(url.searchParams.get("period"));
      const chamber = parsePoliticianChamberFilter(url.searchParams.get("chamber"));
      json(res, 200, getPoliticianMostAccumulated(period, chamber), 120);
      return true;
    }

    if (ROUTE_LARGEST_PORTFOLIOS_RE.test(url.pathname)) {
      const period = parsePoliticianAnalyticsPeriod(url.searchParams.get("period"));
      const chamber = parsePoliticianChamberFilter(url.searchParams.get("chamber"));
      json(res, 200, getPoliticianLargestPortfolios(period, chamber), 120);
      return true;
    }

    if (ROUTE_REPEAT_BUYERS_RE.test(url.pathname)) {
      try {
        json(res, 200, await getPoliticianRepeatBuyers(url), 120);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { error: "politician_repeat_buyers_error", message });
      }
      return true;
    }

    if (ROUTE_FIRST_TIME_BUYERS_RE.test(url.pathname)) {
      try {
        json(res, 200, await getPoliticianFirstTimeBuyers(url), 120);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { error: "politician_first_time_buyers_error", message });
      }
      return true;
    }

    if (ROUTE_HEAVY_SELLING_RE.test(url.pathname)) {
      try {
        json(res, 200, await getPoliticianHeavySelling(url), 120);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { error: "politician_heavy_selling_error", message });
      }
      return true;
    }

    return false;
  }

  const payload = readPoliticiansRecent();
  if (!payload) {
    json(res, 404, {
      error: "not_found",
      message:
        "No politician data yet. Run: npm run politicians:fetch-recent",
    });
    return true;
  }

  json(res, 200, payload, 120);
  return true;
}
